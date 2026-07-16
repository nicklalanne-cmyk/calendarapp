import { NextResponse, type NextRequest } from "next/server";
import { authenticateApiRequest } from "@/lib/apiAuth";
import { getGoogleAccessToken } from "@/lib/google/tokens";
import { listCalendars, listEventsRaw, createEventRaw, mapEvent } from "@/lib/google/calendar";
import type { CalendarEvent } from "@/lib/types";
import type { GoogleAccountRow } from "@/lib/google/session";
import { runTriggerAutomations } from "@/lib/automations";
import { sendPushToUser } from "@/lib/push-server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await authenticateApiRequest(req);
  if (!auth.ok) return auth.response;
  const { db, userId } = auth;

  const timeMin = req.nextUrl.searchParams.get("timeMin");
  const timeMax = req.nextUrl.searchParams.get("timeMax");
  if (!timeMin || !timeMax) {
    return NextResponse.json({ error: "timeMin and timeMax required" }, { status: 400 });
  }

  const { data } = await db.from("google_accounts").select("*").eq("user_id", userId);
  const accounts = (data as GoogleAccountRow[] | null) ?? [];
  if (accounts.length === 0) return NextResponse.json({ events: [], noAccounts: true });

  const all: CalendarEvent[] = [];
  const errors: string[] = [];

  await Promise.all(
    accounts.map(async (acc) => {
      const token = await getGoogleAccessToken(acc.refresh_token);
      if (!token) {
        errors.push(acc.google_email);
        return;
      }
      try {
        const cals = await listCalendars(token);
        const visible = cals.filter((c) => c.selected !== false);
        await Promise.all(
          visible.map(async (cal) => {
            try {
              const raw = await listEventsRaw(token, cal.id, timeMin, timeMax);
              for (const e of raw) {
                all.push(
                  mapEvent(e, {
                    accountId: acc.id,
                    accountEmail: acc.google_email,
                    calendarId: cal.id,
                    color: cal.backgroundColor,
                  })
                );
              }
            } catch {
              /* skip a single calendar that errors */
            }
          })
        );
      } catch {
        errors.push(acc.google_email);
      }
    })
  );

  return NextResponse.json({ events: all, errors });
}

export async function POST(req: NextRequest) {
  const auth = await authenticateApiRequest(req);
  if (!auth.ok) return auth.response;
  const { db, userId } = auth;

  const body = (await req.json().catch(() => ({}))) as {
    title?: string;
    start?: string;
    end?: string;
    accountId?: string;
    calendarId?: string;
    location?: string | null;
    description?: string | null;
    recurrence?: string[] | null;
  };
  if (!body.start || !body.end) {
    return NextResponse.json({ error: "start and end required" }, { status: 400 });
  }

  const { data } = await db.from("google_accounts").select("*").eq("user_id", userId);
  const accounts = (data as GoogleAccountRow[] | null) ?? [];
  if (accounts.length === 0) return NextResponse.json({ error: "no_accounts" }, { status: 400 });

  const target =
    (body.accountId && accounts.find((a) => a.id === body.accountId)) ||
    accounts.find((a) => a.is_default) ||
    accounts[0];

  const token = await getGoogleAccessToken(target.refresh_token);
  if (!token) return NextResponse.json({ error: "token_refresh_failed" }, { status: 502 });

  const calendarId = body.calendarId ?? "primary";
  try {
    const e = await createEventRaw(token, calendarId, {
      title: body.title ?? "(No title)",
      start: body.start,
      end: body.end,
      location: body.location ?? null,
      description: body.description ?? null,
      recurrence: body.recurrence ?? null,
    });
    await runTriggerAutomations(
      db,
      "event_created",
      {
        title: e.summary ?? body.title ?? "(No title)",
        location: body.location ?? null,
        anchorDate: new Date(body.start),
        entity: null,
      },
      userId,
      sendPushToUser
    );
    return NextResponse.json({
      event: mapEvent(e, {
        accountId: target.id,
        accountEmail: target.google_email,
        calendarId,
        color: null,
      }),
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
