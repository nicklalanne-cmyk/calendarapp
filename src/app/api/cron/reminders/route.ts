import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Sub = { id: string; user_id: string; endpoint: string; p256dh: string; auth: string };
type Settings = { user_id: string; digest_hour: number; timezone: string; push_enabled: boolean };
type Task = { id: string; user_id: string; title: string; due_date: string | null; priority: number };

/**
 * Runs on a Vercel cron (every 15 min). Sends:
 *   - a morning digest of what's due today, at each user's chosen hour
 *   - a nudge for anything that's newly overdue
 * Deduped via push_log so a user never gets the same notification twice.
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

  if (!url || !serviceKey || !vapidPublic || !vapidPrivate) {
    return NextResponse.json(
      {
        error:
          "Push isn't configured. Needs SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY.",
      },
      { status: 501 }
    );
  }

  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || "mailto:nick@oneluxuryint.com",
    vapidPublic,
    vapidPrivate
  );

  // service role: the cron runs with no user session, so RLS is bypassed deliberately
  const db = createClient(url, serviceKey, { auth: { persistSession: false } });

  const { data: settingsRows } = await db
    .from("user_settings")
    .select("user_id, digest_hour, timezone, push_enabled")
    .eq("push_enabled", true);
  const settings = (settingsRows as Settings[] | null) ?? [];
  if (settings.length === 0) return NextResponse.json({ sent: 0, reason: "nobody subscribed" });

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

  return NextResponse.json({ sent, errors: results });
}
