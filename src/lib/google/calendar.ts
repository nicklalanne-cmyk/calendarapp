import type { CalendarEvent, Attendee } from "@/lib/types";

const CAL_BASE = "https://www.googleapis.com/calendar/v3";

type GAttendee = {
  email?: string;
  displayName?: string;
  responseStatus?: string;
  self?: boolean;
  organizer?: boolean;
};

type GEvent = {
  id: string;
  summary?: string;
  recurringEventId?: string;
  recurrence?: string[];
  location?: string;
  description?: string;
  htmlLink?: string;
  hangoutLink?: string;
  attendees?: GAttendee[];
  conferenceData?: {
    entryPoints?: { entryPointType?: string; uri?: string }[];
  };
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
};

export type GCalListItem = {
  id: string;
  summary?: string;
  primary?: boolean;
  selected?: boolean;
  backgroundColor?: string;
  accessRole?: string;
};

export type EventContext = {
  accountId: string;
  accountEmail: string;
  calendarId: string;
  color?: string | null;
};

function meetingLinkOf(e: GEvent): string | null {
  if (e.hangoutLink) return e.hangoutLink;
  const v = e.conferenceData?.entryPoints?.find((ep) => ep.entryPointType === "video");
  return v?.uri ?? null;
}

export function mapEvent(e: GEvent, ctx: EventContext): CalendarEvent {
  const allDay = !e.start?.dateTime;
  const attendees: Attendee[] = (e.attendees ?? [])
    .filter((a) => a.email || a.displayName)
    .map((a) => ({
      email: a.email ?? "",
      name: a.displayName ?? null,
      responseStatus: a.responseStatus ?? null,
      self: a.self ?? false,
      organizer: a.organizer ?? false,
    }));
  return {
    id: e.id,
    title: e.summary ?? "(No title)",
    start: e.start?.dateTime ?? (e.start?.date ? `${e.start.date}T00:00:00` : ""),
    end: e.end?.dateTime ?? (e.end?.date ? `${e.end.date}T00:00:00` : ""),
    allDay,
    color: ctx.color ?? null,
    location: e.location ?? null,
    description: e.description ?? null,
    attendees,
    meetingLink: meetingLinkOf(e),
    htmlLink: e.htmlLink ?? null,
    recurring: Boolean(e.recurringEventId || (e.recurrence && e.recurrence.length > 0)),
    accountId: ctx.accountId,
    accountEmail: ctx.accountEmail,
    calendarId: ctx.calendarId,
    source: "google",
  };
}

export async function listCalendars(accessToken: string): Promise<GCalListItem[]> {
  const res = await fetch(`${CAL_BASE}/users/me/calendarList?maxResults=250`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`calendarList failed: ${res.status}`);
  const data = (await res.json()) as { items?: GCalListItem[] };
  return data.items ?? [];
}

export async function listEventsRaw(
  accessToken: string,
  calendarId: string,
  timeMin: string,
  timeMax: string
): Promise<GEvent[]> {
  const url = new URL(`${CAL_BASE}/calendars/${encodeURIComponent(calendarId)}/events`);
  url.searchParams.set("timeMin", timeMin);
  url.searchParams.set("timeMax", timeMax);
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("orderBy", "startTime");
  url.searchParams.set("maxResults", "250");
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`events.list failed: ${res.status}`);
  const data = (await res.json()) as { items?: GEvent[] };
  return data.items ?? [];
}

type WriteInput = {
  title: string;
  /** Timed events: an ISO datetime. All-day events: a plain "yyyy-MM-dd" date
   * string — `end` must be the day AFTER the last inclusive day, per Google's
   * exclusive-end-date convention for all-day events. */
  start: string;
  end: string;
  /** When true, `start`/`end` above are date-only strings, not datetimes. */
  allDay?: boolean;
  location?: string | null;
  description?: string | null;
  recurrence?: string[] | null;
};

export async function createEventRaw(
  accessToken: string,
  calendarId: string,
  input: WriteInput
): Promise<GEvent> {
  const body: Record<string, unknown> = {
    summary: input.title,
    start: input.allDay ? { date: input.start } : { dateTime: input.start },
    end: input.allDay ? { date: input.end } : { dateTime: input.end },
  };
  if (input.location != null) body.location = input.location;
  if (input.description != null) body.description = input.description;
  if (input.recurrence && input.recurrence.length > 0) body.recurrence = input.recurrence;
  const res = await fetch(`${CAL_BASE}/calendars/${encodeURIComponent(calendarId)}/events`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`events.insert failed: ${res.status}`);
  return (await res.json()) as GEvent;
}

export async function updateEventRaw(
  accessToken: string,
  calendarId: string,
  eventId: string,
  patch: {
    title?: string;
    start?: string;
    end?: string;
    /** See WriteInput.allDay — applies to both start and end together. */
    allDay?: boolean;
    location?: string | null;
    description?: string | null;
  }
): Promise<GEvent> {
  const body: Record<string, unknown> = {};
  if (patch.title !== undefined) body.summary = patch.title;
  if (patch.start !== undefined) body.start = patch.allDay ? { date: patch.start } : { dateTime: patch.start };
  if (patch.end !== undefined) body.end = patch.allDay ? { date: patch.end } : { dateTime: patch.end };
  if (patch.location !== undefined) body.location = patch.location;
  if (patch.description !== undefined) body.description = patch.description;
  const res = await fetch(
    `${CAL_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    {
      method: "PATCH",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
  if (!res.ok) throw new Error(`events.patch failed: ${res.status}`);
  return (await res.json()) as GEvent;
}

export async function deleteEventRaw(
  accessToken: string,
  calendarId: string,
  eventId: string
): Promise<void> {
  const res = await fetch(
    `${CAL_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    { method: "DELETE", headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok && res.status !== 410) throw new Error(`events.delete failed: ${res.status}`);
}
