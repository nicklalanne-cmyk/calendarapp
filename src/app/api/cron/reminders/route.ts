import { NextResponse, type NextRequest } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import webpush from "web-push";
import { rulesForTrigger, runActions, matchesAll, taskCtx, type TaskLike, type RuleConfig } from "@/lib/automations";
import { sendPushToUser } from "@/lib/push-server";
import { sendSms } from "@/lib/sms";
import { buildTodayScheduleText, buildAccomplishedTodayText } from "@/lib/smsDigests";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Sub = { id: string; user_id: string; endpoint: string; p256dh: string; auth: string };
type Settings = { user_id: string; digest_hour: number; timezone: string; push_enabled: boolean };
type Task = { id: string; user_id: string; title: string; due_date: string | null; priority: number };

/**
 * Runs on a Vercel cron (every 15 min). Sends:
 *   - a morning digest of what's due today, at each user's chosen hour
 *   - a nudge for anything that's newly overdue
 *   - fires "On a schedule (days of week)" and "due date coming up" automation rules
 * Deduped via push_log (digest/overdue) and automation_fires (rules) so a user
 * never gets the same notification/action twice.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  // Vercel cron sends `Authorization: Bearer $CRON_SECRET`
  if (secret && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const vapidPublic = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const vapidPrivate = process.env.VAPID_PRIVATE_KEY;

  if (!url || !serviceKey) {
    return NextResponse.json(
      { error: "Cron isn't configured. Needs SUPABASE_SERVICE_ROLE_KEY." },
      { status: 501 }
    );
  }

  // service role: the cron runs with no user session, so RLS is bypassed deliberately
  const db = createClient(url, serviceKey, { auth: { persistSession: false } });

  // --- schedule_weekly rules: fire the configured actions once per local day,
  // on the configured days of the week. Runs regardless of whether push is
  // set up, since actions may not include a notification.
  const scheduleFired = await runScheduleWeeklyAutomations(db);
  // --- date_relative rules: fire once per matching task, per local day.
  const dateRelativeFired = await runDateRelativeAutomations(db);
  const automationsCreated = scheduleFired + dateRelativeFired;

  // --- scheduled SMS digests (Settings → Text notifications)
  const smsSent = await runSmsNotifications(db);

  if (!vapidPublic || !vapidPrivate) {
    return NextResponse.json({
      sent: 0,
      automationsCreated,
      smsSent,
      reason: "push isn't configured (NEXT_PUBLIC_VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY)",
    });
  }

  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || "mailto:nick@oneluxuryint.com",
    vapidPublic,
    vapidPrivate
  );

  const { data: settingsRows } = await db
    .from("user_settings")
    .select("user_id, digest_hour, timezone, push_enabled")
    .eq("push_enabled", true);
  const settings = (settingsRows as Settings[] | null) ?? [];
  if (settings.length === 0) return NextResponse.json({ sent: 0, automationsCreated, smsSent, reason: "nobody subscribed" });

  const { data: subRows } = await db.from("push_subscriptions").select("*");
  const subs = (subRows as Sub[] | null) ?? [];
  const subsByUser = new Map<string, Sub[]>();
  for (const s of subs) {
    if (!subsByUser.has(s.user_id)) subsByUser.set(s.user_id, []);
    subsByUser.get(s.user_id)!.push(s);
  }

  const now = new Date();
  let sent = 0;
  const results: string[] = [];

  for (const st of settings) {
    const mySubs = subsByUser.get(st.user_id) ?? [];
    if (mySubs.length === 0) continue;

    const tz = st.timezone || "UTC";
    const localHour = Number(
      new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hour12: false }).format(now)
    );
    const localDate = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);

    const payloads: { key: string; title: string; body: string; url: string }[] = [];

    // --- morning digest, once per local day, in the hour they picked
    if (localHour === (st.digest_hour ?? 7)) {
      const { data } = await db
        .from("tasks")
        .select("id, user_id, title, due_date, priority")
        .eq("user_id", st.user_id)
        .eq("is_done", false)
        .is("deleted_at", null)
        .is("parent_id", null)
        .lte("due_date", localDate);
      const due = (data as Task[] | null) ?? [];
      if (due.length > 0) {
        const overdue = due.filter((t) => (t.due_date ?? "") < localDate).length;
        const today = due.length - overdue;
        const bits = [
          today > 0 ? `${today} due today` : null,
          overdue > 0 ? `${overdue} overdue` : null,
        ].filter(Boolean);
        payloads.push({
          key: `digest:${localDate}`,
          title: "Today's plan",
          body: `${bits.join(" · ")} — ${due
            .slice(0, 3)
            .map((t) => t.title)
            .join(", ")}${due.length > 3 ? "…" : ""}`,
          url: "/app/agenda",
        });
      }
    }

    // --- newly overdue nudge (once per task, ever)
    const { data: od } = await db
      .from("tasks")
      .select("id, user_id, title, due_date, priority")
      .eq("user_id", st.user_id)
      .eq("is_done", false)
      .is("deleted_at", null)
      .is("parent_id", null)
      .lt("due_date", localDate)
      .lte("priority", 2)
      .gt("priority", 0);
    for (const t of ((od as Task[] | null) ?? []).slice(0, 3)) {
      payloads.push({
        key: `overdue:${t.id}`,
        title: "Overdue",
        body: t.title,
        url: "/app",
      });
    }

    for (const p of payloads) {
      // dedupe: unique(user_id, dedupe_key) means a second insert just fails
      const { error: logErr } = await db
        .from("push_log")
        .insert({ user_id: st.user_id, dedupe_key: p.key });
      if (logErr) continue; // already sent

      for (const s of mySubs) {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            JSON.stringify({ title: p.title, body: p.body, url: p.url, tag: p.key })
          );
          sent++;
        } catch (e) {
          const code = (e as { statusCode?: number }).statusCode;
          // 404/410 = the browser dropped the subscription; bin it
          if (code === 404 || code === 410) {
            await db.from("push_subscriptions").delete().eq("id", s.id);
          }
          results.push(`${s.endpoint.slice(-8)}: ${code ?? (e as Error).message}`);
        }
      }
    }
  }

  return NextResponse.json({ sent, automationsCreated, smsSent, errors: results });
}

/** Sends each user's enabled `sms_notifications` rows once per local day, at
 * the local hour+minute they picked (times are constrained to 15-min
 * increments in the UI so they align with this cron's own tick cadence).
 * Dedup is a row in sms_log keyed on (notification.id, local date). */
async function runSmsNotifications(db: SupabaseClient): Promise<number> {
  const { data: settingsRows } = await db.from("sms_settings").select("user_id, phone_number, enabled").eq("enabled", true);
  const smsSettings = (settingsRows as { user_id: string; phone_number: string | null; enabled: boolean }[] | null) ?? [];
  const withPhone = smsSettings.filter((s) => s.phone_number);
  if (withPhone.length === 0) return 0;

  const userIds = withPhone.map((s) => s.user_id);
  const { data: notifRows } = await db
    .from("sms_notifications")
    .select("id, user_id, kind, hour, minute, enabled, message")
    .in("user_id", userIds)
    .eq("enabled", true);
  const notifs =
    (notifRows as { id: string; user_id: string; kind: string; hour: number; minute: number; enabled: boolean; message: string | null }[] | null) ?? [];
  if (notifs.length === 0) return 0;

  const { data: tzRows } = await db.from("user_settings").select("user_id, timezone").in("user_id", userIds);
  const tzByUser = new Map<string, string>(
    ((tzRows as { user_id: string; timezone: string }[] | null) ?? []).map((s) => [s.user_id, s.timezone || "UTC"])
  );
  const phoneByUser = new Map(withPhone.map((s) => [s.user_id, s.phone_number as string]));

  const now = new Date();
  let sent = 0;

  for (const n of notifs) {
    const tz = tzByUser.get(n.user_id) ?? "UTC";
    const localHour = Number(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hour12: false }).format(now));
    const localMinute = Number(new Intl.DateTimeFormat("en-US", { timeZone: tz, minute: "numeric" }).format(now));
    // The cron only ticks on :00/:15/:30/:45, so match against whichever of
    // those the current minute rounds down to — the local minute at tick
    // time is always exactly one of them.
    const tickMinute = Math.floor(localMinute / 15) * 15;
    if (localHour !== n.hour || tickMinute !== n.minute) continue;

    const localDate = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
    const dedupeKey = `sms:${n.id}:${localDate}`;
    const { error: logErr } = await db.from("sms_log").insert({ user_id: n.user_id, dedupe_key: dedupeKey });
    if (logErr) continue; // already sent today

    let body: string;
    if (n.kind === "today_schedule") {
      body = await buildTodayScheduleText(db, n.user_id, localDate, tz);
    } else if (n.kind === "accomplished_today") {
      body = await buildAccomplishedTodayText(db, n.user_id, localDate, tz);
    } else {
      body = n.message || "";
    }
    if (!body) continue;

    const phone = phoneByUser.get(n.user_id);
    if (!phone) continue;
    const result = await sendSms(phone, body);
    if (result.ok) sent++;
  }
  return sent;
}

/** Runs every enabled "On a schedule (days of week)" rule whose daysOfWeek
 * includes today (in the owning user's local timezone), once per local
 * calendar day. Dedup is a row in automation_fires keyed on (rule.id,
 * rule.id, today) — schedule rules have no per-entity triggering row, so the
 * rule itself stands in as the "entity" for the unique constraint. */
async function runScheduleWeeklyAutomations(db: SupabaseClient): Promise<number> {
  const rules = await rulesForTrigger(db, "schedule_weekly");
  if (rules.length === 0) return 0;

  const userIds = Array.from(new Set(rules.map((r) => r.user_id)));
  const { data: settingsRows } = await db
    .from("user_settings")
    .select("user_id, timezone")
    .in("user_id", userIds);
  const tzByUser = new Map<string, string>(
    ((settingsRows as { user_id: string; timezone: string }[] | null) ?? []).map((s) => [s.user_id, s.timezone || "UTC"])
  );

  let fired = 0;
  const now = new Date();
  for (const rule of rules) {
    const cfg = rule.config as RuleConfig;
    const daysOfWeek = cfg.daysOfWeek ?? [];
    if (daysOfWeek.length === 0) continue;

    const tz = tzByUser.get(rule.user_id) ?? "UTC";
    const localDate = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
    const localDow = new Date(`${localDate}T00:00:00`).getDay();
    if (!daysOfWeek.includes(localDow)) continue;

    const { error: fireErr } = await db
      .from("automation_fires")
      .insert({ rule_id: rule.id, entity_id: rule.id, fired_on: localDate });
    if (fireErr) continue; // already fired today

    await runActions(
      db,
      rule.user_id,
      cfg.actions,
      { title: "", anchorDate: new Date(`${localDate}T00:00:00`), entity: null },
      sendPushToUser
    );
    await db.from("automations").update({ last_run_on: localDate }).eq("id", rule.id);
    fired++;
  }
  return fired;
}

/** Runs every enabled "due date coming up" rule against that user's tasks
 * whose due_date lands exactly daysOffset days from today (local). Dedup is
 * a row in automation_fires keyed on (rule.id, task.id, today), so a task
 * that stays at that offset across repeated 15-min cron ticks (it won't —
 * dates only match once — but also across restarts/re-runs) only fires once. */
async function runDateRelativeAutomations(db: SupabaseClient): Promise<number> {
  const rules = await rulesForTrigger(db, "date_relative");
  if (rules.length === 0) return 0;

  const userIds = Array.from(new Set(rules.map((r) => r.user_id)));
  const { data: settingsRows } = await db
    .from("user_settings")
    .select("user_id, timezone")
    .in("user_id", userIds);
  const tzByUser = new Map<string, string>(
    ((settingsRows as { user_id: string; timezone: string }[] | null) ?? []).map((s) => [s.user_id, s.timezone || "UTC"])
  );

  let fired = 0;
  const now = new Date();
  for (const rule of rules) {
    const cfg = rule.config as RuleConfig;
    const daysOffset = cfg.daysOffset ?? 1;

    const tz = tzByUser.get(rule.user_id) ?? "UTC";
    const localDate = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
    const target = new Date(`${localDate}T00:00:00`);
    target.setDate(target.getDate() + daysOffset);
    const targetDate = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(
      target
    );

    const { data: matches } = await db
      .from("tasks")
      .select("id, title, project, tags, priority, due_date")
      .eq("user_id", rule.user_id)
      .eq("is_done", false)
      .is("deleted_at", null)
      .is("parent_id", null)
      .eq("due_date", targetDate);
    const tasks = (matches as TaskLike[] | null) ?? [];

    for (const t of tasks) {
      const ctx = taskCtx(t);
      if (!matchesAll(ctx, cfg.conditions, cfg.matchType)) continue;

      const { error: fireErr } = await db
        .from("automation_fires")
        .insert({ rule_id: rule.id, entity_id: t.id, fired_on: localDate });
      if (fireErr) continue; // already fired for this task today

      await runActions(db, rule.user_id, cfg.actions, ctx, sendPushToUser);
      await db.from("automations").update({ last_run_on: localDate }).eq("id", rule.id);
      fired++;
    }
  }
  return fired;
}
