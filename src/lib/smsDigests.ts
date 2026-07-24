import type { SupabaseClient } from "@supabase/supabase-js";
import { getGoogleAccessToken } from "@/lib/google/tokens";
import { listCalendars, listEventsRaw } from "@/lib/google/calendar";
import { motivationalQuoteFor, introspectiveQuoteFor } from "@/lib/quotes";

/**
 * Server-only. Builds the plain-text body for the scheduled SMS digests and
 * reminders. Kept separate from the cron route itself so the content logic
 * can be unit-tested/reused (e.g. by a "send test text" button) without
 * pulling in the whole cron handler.
 */

type GoogleAccountRow = { id: string; refresh_token: string; is_default: boolean };
type TaskRow = { id: string; title: string; due_date: string | null; scheduled_start: string | null; location: string | null };
type DayEvent = { title: string; start: string; allDay: boolean; location: string | null };

function fmtTime(iso: string): string {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

function fmtDayLabel(localDate: string, tz: string): string {
  const d = new Date(`${localDate}T12:00:00`);
  return new Intl.DateTimeFormat("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: tz }).format(d);
}

/** Every calendar event (across every connected Google account) on the
 * given local day, sorted by start time. Shared by both digests — the
 * morning one shows what's coming up, the evening one shows what happened. */
async function fetchTodaysEvents(db: SupabaseClient, userId: string, localDate: string): Promise<DayEvent[]> {
  const { data: accountRows } = await db.from("google_accounts").select("id, refresh_token, is_default").eq("user_id", userId);
  const accounts = (accountRows as GoogleAccountRow[] | null) ?? [];

  // Local midnight-to-midnight window, expressed in UTC for the Calendar API.
  const dayStart = new Date(`${localDate}T00:00:00`);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);

  const events: DayEvent[] = [];
  await Promise.all(
    accounts.map(async (acc) => {
      const token = await getGoogleAccessToken(acc.refresh_token);
      if (!token) return;
      try {
        const cals = await listCalendars(token);
        await Promise.all(
          cals
            .filter((c) => c.selected !== false)
            .map(async (cal) => {
              try {
                const raw = await listEventsRaw(token, cal.id, dayStart.toISOString(), dayEnd.toISOString());
                for (const e of raw) {
                  events.push({
                    title: e.summary ?? "(No title)",
                    start: e.start?.dateTime ?? (e.start?.date ? `${e.start.date}T00:00:00` : dayStart.toISOString()),
                    allDay: !e.start?.dateTime,
                    location: e.location ?? null,
                  });
                }
              } catch {
                /* skip calendar */
              }
            })
        );
      } catch {
        /* skip account */
      }
    })
  );
  events.sort((a, b) => a.start.localeCompare(b.start));
  return events;
}

function formatEventBullets(events: DayEvent[], max = 8): string[] {
  const lines: string[] = [];
  for (const e of events.slice(0, max)) {
    const loc = e.location ? ` — ${e.location}` : "";
    lines.push(e.allDay ? `• All day: ${e.title}${loc}` : `• ${fmtTime(e.start)} ${e.title}${loc}`);
  }
  if (events.length > max) lines.push(`…+${events.length - max} more on your calendar`);
  return lines;
}

/** Today's calendar events (across every connected Google account) + tasks
 * due today, formatted for a single SMS. Bulleted; includes each event's/
 * task's address when one is set. Ends with a quote-of-the-day to kick off
 * the morning. */
export async function buildTodayScheduleText(
  db: SupabaseClient,
  userId: string,
  localDate: string,
  tz: string
): Promise<string> {
  const dayLabel = fmtDayLabel(localDate, tz);
  const events = await fetchTodaysEvents(db, userId, localDate);

  const { data: taskRows } = await db
    .from("tasks")
    .select("id, title, due_date, scheduled_start, location")
    .eq("user_id", userId)
    .eq("is_done", false)
    .is("deleted_at", null)
    .is("parent_id", null)
    .eq("due_date", localDate)
    .order("sort_order", { ascending: true });
  const tasks = (taskRows as TaskRow[] | null) ?? [];

  const lines: string[] = [`Today (${dayLabel}):`];

  if (events.length > 0) {
    lines.push(...formatEventBullets(events));
  } else {
    lines.push("No calendar events.");
  }

  if (tasks.length > 0) {
    lines.push(`Tasks (${tasks.length}):`);
    for (const t of tasks.slice(0, 8)) {
      const loc = t.location ? ` — ${t.location}` : "";
      lines.push(`• ${t.title}${loc}`);
    }
    if (tasks.length > 8) lines.push(`…+${tasks.length - 8} more`);
  }

  lines.push("", motivationalQuoteFor(localDate));

  return lines.join("\n");
}

/** Everything that happened today: calendar events that were on the books
 * plus tasks actually completed (via the completed_at trigger), formatted
 * for a single SMS as bulleted lists. Ends with a quote-of-the-day to close
 * out the evening. */
export async function buildAccomplishedTodayText(
  db: SupabaseClient,
  userId: string,
  localDate: string,
  tz: string
): Promise<string> {
  const dayLabel = fmtDayLabel(localDate, tz);
  const dayStart = new Date(`${localDate}T00:00:00`);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);

  const [events, { data }] = await Promise.all([
    fetchTodaysEvents(db, userId, localDate),
    db
      .from("tasks")
      .select("id, title")
      .eq("user_id", userId)
      .eq("is_done", true)
      .is("deleted_at", null)
      .gte("completed_at", dayStart.toISOString())
      .lt("completed_at", dayEnd.toISOString()),
  ]);
  const done = (data as { id: string; title: string }[] | null) ?? [];

  const lines: string[] = [];
  if (events.length === 0 && done.length === 0) {
    lines.push(`${dayLabel}: nothing on the calendar or checked off today. Tomorrow's a clean slate.`);
  } else {
    lines.push(`${dayLabel}:`);
    if (events.length > 0) {
      lines.push(`Events (${events.length}):`);
      lines.push(...formatEventBullets(events));
    }
    if (done.length > 0) {
      lines.push(`Completed ${done.length} ${done.length === 1 ? "task" : "tasks"}:`);
      for (const t of done.slice(0, 12)) lines.push(`• ${t.title}`);
      if (done.length > 12) lines.push(`…+${done.length - 12} more`);
    }
  }

  lines.push("", introspectiveQuoteFor(localDate));

  return lines.join("\n");
}

export type ReminderMatch = {
  /** A stable dedupe key unique to this specific occurrence (event id + its
   * current start time, or task id + its current scheduled_start) — so
   * rescheduling something later lets it remind again instead of being
   * permanently marked "already sent". */
  dedupeKey: string;
  userId: string;
  title: string;
  start: string;
  location: string | null;
};

type TaskReminderRow = {
  id: string;
  user_id: string;
  title: string;
  scheduled_start: string;
  location: string | null;
  reminder_lead_minutes: number;
};

/** Every enabled user's tasks that have their own "remind me" set (via the
 * task modal) and a scheduled_start to count down from, whose reminder time
 * (scheduled_start − lead_minutes) falls within the next `tickMinutes`
 * minutes — i.e. it's due to fire on this cron tick. Tasks with no
 * scheduled_start never have a reminder option in the UI, so this only ever
 * matches tasks that were actually placed on a specific time. */
export async function findDueTaskReminders(
  db: SupabaseClient,
  userIds: string[],
  now: Date,
  tickMinutes: number
): Promise<ReminderMatch[]> {
  if (userIds.length === 0) return [];
  const { data } = await db
    .from("tasks")
    .select("id, user_id, title, scheduled_start, location, reminder_lead_minutes")
    .in("user_id", userIds)
    .eq("is_done", false)
    .is("deleted_at", null)
    .not("reminder_lead_minutes", "is", null)
    .not("scheduled_start", "is", null)
    // scheduled_start can be at most a bit over a week away and still matter
    // (the longest lead preset is 1 week) — bound the query instead of
    // scanning every future task.
    .lte("scheduled_start", new Date(now.getTime() + 8 * 24 * 60 * 60_000).toISOString());
  const rows = (data as TaskReminderRow[] | null) ?? [];

  const matches: ReminderMatch[] = [];
  for (const t of rows) {
    const remindAt = new Date(t.scheduled_start).getTime() - t.reminder_lead_minutes * 60_000;
    const diffMin = (remindAt - now.getTime()) / 60_000;
    if (diffMin < 0 || diffMin >= tickMinutes) continue;
    matches.push({
      dedupeKey: `sms:task_reminder:${t.id}:${t.scheduled_start}`,
      userId: t.user_id,
      title: t.title,
      start: t.scheduled_start,
      location: t.location,
    });
  }
  return matches;
}

type EventReminderRow = {
  id: string;
  user_id: string;
  account_id: string;
  calendar_id: string;
  event_id: string;
  lead_minutes: number;
};

/** Every enabled user's per-event "remind me" rows (set via the event
 * modal) whose reminder time falls within the next `tickMinutes` minutes.
 * Each row's event is re-fetched live from Google so a rescheduled event's
 * current start time (not whatever it was when the reminder was set) is
 * what actually counts down. */
export async function findDueEventReminders(
  db: SupabaseClient,
  userIds: string[],
  now: Date,
  tickMinutes: number
): Promise<ReminderMatch[]> {
  if (userIds.length === 0) return [];
  const { data } = await db.from("event_reminders").select("id, user_id, account_id, calendar_id, event_id, lead_minutes").in("user_id", userIds);
  const rows = (data as EventReminderRow[] | null) ?? [];
  if (rows.length === 0) return [];

  const accountIds = Array.from(new Set(rows.map((r) => r.account_id)));
  const { data: accountRows } = await db.from("google_accounts").select("id, refresh_token").in("id", accountIds);
  const tokenByAccount = new Map<string, string>();
  await Promise.all(
    ((accountRows as { id: string; refresh_token: string }[] | null) ?? []).map(async (acc) => {
      const token = await getGoogleAccessToken(acc.refresh_token);
      if (token) tokenByAccount.set(acc.id, token);
    })
  );

  const matches: ReminderMatch[] = [];
  await Promise.all(
    rows.map(async (r) => {
      const token = tokenByAccount.get(r.account_id);
      if (!token) return;
      try {
        const raw = await listEventsRaw(
          token,
          r.calendar_id,
          new Date(now.getTime() - 24 * 60 * 60_000).toISOString(),
          new Date(now.getTime() + 8 * 24 * 60 * 60_000).toISOString()
        );
        const e = raw.find((ev) => ev.id === r.event_id);
        if (!e?.start?.dateTime) return; // deleted, moved out of range, or now all-day
        const remindAt = new Date(e.start.dateTime).getTime() - r.lead_minutes * 60_000;
        const diffMin = (remindAt - now.getTime()) / 60_000;
        if (diffMin < 0 || diffMin >= tickMinutes) return;
        matches.push({
          dedupeKey: `sms:event_reminder:${r.id}:${e.start.dateTime}`,
          userId: r.user_id,
          title: e.summary ?? "(No title)",
          start: e.start.dateTime,
          location: e.location ?? null,
        });
      } catch {
        /* skip — event/calendar unreachable this tick */
      }
    })
  );
  return matches;
}

export function formatReminderText(kind: "event" | "task", m: ReminderMatch): string {
  const time = fmtTime(m.start);
  const prefix = kind === "event" ? "Reminder" : "Task reminder";
  const loc = m.location ? ` — ${m.location}` : "";
  return `${prefix}: ${m.title} at ${time}${loc}`;
}
