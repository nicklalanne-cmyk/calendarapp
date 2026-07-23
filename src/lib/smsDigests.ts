import type { SupabaseClient } from "@supabase/supabase-js";
import { getGoogleAccessToken } from "@/lib/google/tokens";
import { listCalendars, listEventsRaw } from "@/lib/google/calendar";

/**
 * Server-only. Builds the plain-text body for the two built-in scheduled
 * SMS digests. Kept separate from the cron route itself so the content
 * logic can be unit-tested/reused (e.g. by a "send test text" button)
 * without pulling in the whole cron handler.
 */

type GoogleAccountRow = { id: string; refresh_token: string; is_default: boolean };
type TaskRow = { id: string; title: string; due_date: string | null; scheduled_start: string | null };

function fmtTime(iso: string): string {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

function fmtDayLabel(localDate: string, tz: string): string {
  const d = new Date(`${localDate}T12:00:00`);
  return new Intl.DateTimeFormat("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: tz }).format(d);
}

/** Today's calendar events (across every connected Google account) + tasks
 * due today, formatted for a single SMS. */
export async function buildTodayScheduleText(
  db: SupabaseClient,
  userId: string,
  localDate: string,
  tz: string
): Promise<string> {
  const dayLabel = fmtDayLabel(localDate, tz);

  const { data: accountRows } = await db.from("google_accounts").select("id, refresh_token, is_default").eq("user_id", userId);
  const accounts = (accountRows as GoogleAccountRow[] | null) ?? [];

  // Local midnight-to-midnight window, expressed in UTC for the Calendar API.
  const dayStart = new Date(`${localDate}T00:00:00`);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);

  const events: { title: string; start: string; allDay: boolean }[] = [];
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

  const { data: taskRows } = await db
    .from("tasks")
    .select("id, title, due_date, scheduled_start")
    .eq("user_id", userId)
    .eq("is_done", false)
    .is("deleted_at", null)
    .is("parent_id", null)
    .eq("due_date", localDate)
    .order("sort_order", { ascending: true });
  const tasks = (taskRows as TaskRow[] | null) ?? [];

  const lines: string[] = [`Today (${dayLabel}):`];

  if (events.length > 0) {
    for (const e of events.slice(0, 8)) {
      lines.push(e.allDay ? `• All day: ${e.title}` : `• ${fmtTime(e.start)} ${e.title}`);
    }
    if (events.length > 8) lines.push(`…+${events.length - 8} more on your calendar`);
  } else {
    lines.push("No calendar events.");
  }

  if (tasks.length > 0) {
    lines.push(`Tasks (${tasks.length}): ${tasks.slice(0, 6).map((t) => t.title).join(", ")}${tasks.length > 6 ? "…" : ""}`);
  }

  return lines.join("\n");
}

/** Tasks actually completed today (via the completed_at trigger), formatted
 * for a single SMS. */
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

  const { data } = await db
    .from("tasks")
    .select("id, title")
    .eq("user_id", userId)
    .eq("is_done", true)
    .is("deleted_at", null)
    .gte("completed_at", dayStart.toISOString())
    .lt("completed_at", dayEnd.toISOString());
  const done = (data as { id: string; title: string }[] | null) ?? [];

  if (done.length === 0) {
    return `${dayLabel}: nothing checked off today. Tomorrow's a clean slate.`;
  }
  const titles = done.slice(0, 10).map((t) => t.title).join(", ");
  return `Nice work today (${dayLabel})! You completed ${done.length} ${done.length === 1 ? "task" : "tasks"}: ${titles}${done.length > 10 ? "…" : ""}`;
}
