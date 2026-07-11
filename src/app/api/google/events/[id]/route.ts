import { NextResponse, type NextRequest } from "next/server";
import { requireUser, type GoogleAccountRow } from "@/lib/google/session";
import { getGoogleAccessToken } from "@/lib/google/tokens";
import { updateEventRaw, deleteEventRaw, mapEvent } from "@/lib/google/calendar";

export const dynamic = "force-dynamic";

async function resolve(request: NextRequest) {
  const { supabase, user } = await requireUser();
  if (!user) return { error: "not_signed_in", status: 401 as const };

  const accountId = request.nextUrl.searchParams.get("accountId");
  const calendarId = request.nextUrl.searchParams.get("calendarId") ?? "primary";
  if (!accountId) return { error: "accountId required", status: 400 as const };

  const { data } = await supabase
    .from("google_accounts")
    .select("*")
    .eq("id", accountId)
    .maybeSingle();
  const acc = data as GoogleAccountRow | null;
  if (!acc) return { error: "account not found", status: 404 as const };

  const token = await getGoogleAccessToken(acc.refresh_token);
  if (!token) return { error: "token_refresh_failed", status: 502 as const };

  return { acc, token, calendarId };
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const r = await resolve(request);
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: r.status });

  const body = (await request.json()) as {
    title?: string;
    start?: string;
    end?: string;
    location?: string | null;
    description?: string | null;
  };
  try {
    const e = await updateEventRaw(r.token, r.calendarId, params.id, body);
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

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const r = await resolve(request);
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: r.status });
  try {
    await deleteEventRaw(r.token, r.calendarId, params.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
