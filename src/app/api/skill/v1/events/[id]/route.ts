import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { authenticateApiRequest } from "@/lib/apiAuth";
import { getGoogleAccessToken } from "@/lib/google/tokens";
import { updateEventRaw, deleteEventRaw, mapEvent } from "@/lib/google/calendar";
import type { GoogleAccountRow } from "@/lib/google/session";
import { runTriggerAutomations } from "@/lib/automations";
import { sendPushToUser } from "@/lib/push-server";

export const dynamic = "force-dynamic";

async function resolve(req: NextRequest, db: SupabaseClient, userId: string) {
  const accountId = req.nextUrl.searchParams.get("accountId");
  const calendarId = req.nextUrl.searchParams.get("calendarId") ?? "primary";
  if (!accountId) return { error: "accountId required", status: 400 as const };

  const { data } = await db
    .from("google_accounts")
    .select("*")
    .eq("id", accountId)
    .eq("user_id", userId)
    .maybeSingle();
  const acc = data as GoogleAccountRow | null;
  if (!acc) return { error: "account not found", status: 404 as const };

  const token = await getGoogleAccessToken(acc.refresh_token);
  if (!token) return { error: "token_refresh_failed", status: 502 as const };

  return { acc, token, calendarId };
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await authenticateApiRequest(req);
  if (!auth.ok) return auth.response;
  const r = await resolve(req, auth.db, auth.userId);
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: r.status });

  const body = (await req.json().catch(() => ({}))) as {
    title?: string;
    start?: string;
    end?: string;
    location?: string | null;
    description?: string | null;
  };
  try {
    const e = await updateEventRaw(r.token, r.calendarId, params.id, body);
    await runTriggerAutomations(
      auth.db,
      "event_updated",
      {
        title: e.summary ?? body.title ?? "",
        location: (body.location ?? e.location ?? null) as string | null,
        anchorDate: new Date(e.start?.dateTime ?? e.start?.date ?? Date.now()),
        entity: null,
      },
      auth.userId,
      sendPushToUser
    );
    return NextResponse.json({
      event: mapEvent(e, {
        accountId: r.acc.id,
        accountEmail: r.acc.google_email,
        calendarId: r.calendarId,
        color: null,
      }),
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await authenticateApiRequest(req);
  if (!auth.ok) return auth.response;
  const r = await resolve(req, auth.db, auth.userId);
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: r.status });
  try {
    await deleteEventRaw(r.token, r.calendarId, params.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
