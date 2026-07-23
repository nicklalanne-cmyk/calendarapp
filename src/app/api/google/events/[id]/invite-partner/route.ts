import { NextResponse, type NextRequest } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { requireUser, type GoogleAccountRow } from "@/lib/google/session";
import { getGoogleAccessToken } from "@/lib/google/tokens";
import { getEventRaw, updateEventRaw } from "@/lib/google/calendar";

export const dynamic = "force-dynamic";

// "Share with partner" used to only ever write a read-only snapshot into
// `shared_events` — it never touched Google, so it never sent an invite or
// put anything on the partner's real calendar (this is what Nick reported:
// Gaby shared an event and it never showed up anywhere he'd expect). This
// route does the real thing instead: adds the partner as a Google Calendar
// attendee on the actual event, with sendUpdates=all so Google emails a
// genuine invite and the event lands on their real calendar the normal way.
//
// Finding the partner's Google address needs a cross-user read that RLS
// deliberately blocks on google_accounts (it also holds refresh_token, so
// no partner-read policy exists there) — a service-role client is used
// here only to pull that one email column server-side; nothing broader is
// exposed to the caller.
async function resolvePartnerEmail(callerUserId: string): Promise<
  { email: string } | { error: "no_partner_linked" | "partner_no_google_account" }
> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return { error: "partner_no_google_account" };
  const db = createServiceClient(url, serviceKey, { auth: { persistSession: false } });

  const { data: link } = await db
    .from("partner_links")
    .select("partner_id")
    .eq("user_id", callerUserId)
    .maybeSingle();
  if (!link) return { error: "no_partner_linked" };

  const { data: accounts } = await db
    .from("google_accounts")
    .select("google_email, is_default")
    .eq("user_id", (link as { partner_id: string }).partner_id);
  const rows = (accounts as { google_email: string; is_default: boolean }[] | null) ?? [];
  const chosen = rows.find((a) => a.is_default) ?? rows[0];
  if (!chosen) return { error: "partner_no_google_account" };
  return { email: chosen.google_email };
}

async function resolveOwnAccount(request: NextRequest) {
  const { supabase, user } = await requireUser();
  if (!user) return { error: "not_signed_in", status: 401 as const };

  const accountId = request.nextUrl.searchParams.get("accountId");
  const calendarId = request.nextUrl.searchParams.get("calendarId") ?? "primary";
  if (!accountId) return { error: "accountId required", status: 400 as const };

  const { data } = await supabase.from("google_accounts").select("*").eq("id", accountId).maybeSingle();
  const acc = data as GoogleAccountRow | null;
  if (!acc) return { error: "account not found", status: 404 as const };

  const token = await getGoogleAccessToken(acc.refresh_token);
  if (!token) return { error: "token_refresh_failed", status: 502 as const };

  return { user, token, calendarId };
}

// Adds the caller's partner as a real attendee on this event — sends an
// actual Google Calendar invite email and puts it on their calendar.
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const r = await resolveOwnAccount(request);
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: r.status });

  const partner = await resolvePartnerEmail(r.user.id);
  if ("error" in partner) return NextResponse.json({ error: partner.error }, { status: 409 });

  try {
    const event = await getEventRaw(r.token, r.calendarId, params.id);
    const existing = (event.attendees ?? []).map((a) => ({ email: a.email ?? "" })).filter((a) => a.email);
    if (existing.some((a) => a.email.toLowerCase() === partner.email.toLowerCase())) {
      return NextResponse.json({ ok: true, alreadyInvited: true, email: partner.email });
    }
    await updateEventRaw(
      r.token,
      r.calendarId,
      params.id,
      { attendees: [...existing, { email: partner.email }] },
      "all"
    );
    return NextResponse.json({ ok: true, invited: true, email: partner.email });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}

// Removes the partner as an attendee — Google emails them a cancellation
// notice for their invite (the event itself isn't deleted, just their
// invite to it), mirroring the old "unshare" toggle.
export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const r = await resolveOwnAccount(request);
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: r.status });

  const partner = await resolvePartnerEmail(r.user.id);
  if ("error" in partner) return NextResponse.json({ error: partner.error }, { status: 409 });

  try {
    const event = await getEventRaw(r.token, r.calendarId, params.id);
    const existing = (event.attendees ?? []).map((a) => ({ email: a.email ?? "" })).filter((a) => a.email);
    const next = existing.filter((a) => a.email.toLowerCase() !== partner.email.toLowerCase());
    if (next.length === existing.length) {
      return NextResponse.json({ ok: true, wasNotInvited: true });
    }
    await updateEventRaw(r.token, r.calendarId, params.id, { attendees: next }, "all");
    return NextResponse.json({ ok: true, removed: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
