import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/google/session";
import { sendSms, normalizePhone } from "@/lib/sms";
import { buildTodayScheduleText, buildAccomplishedTodayText } from "@/lib/smsDigests";

export const dynamic = "force-dynamic";

/** "Send test text" button in Settings — sends an immediate SMS to the
 * caller's own configured number. With no `kind` (or kind: "generic") it's
 * just a wiring check. With kind: "today_schedule" | "accomplished_today" it
 * builds and sends the REAL digest content live, using the caller's own
 * connected Google account and current data — not a canned message — so
 * someone can confirm calendar events/tasks actually show up correctly
 * without waiting for the scheduled 7am/8pm run. */
export async function POST(request: NextRequest) {
  const { supabase, user } = await requireUser();
  if (!user) return NextResponse.json({ error: "not_signed_in" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as {
    phone?: string;
    kind?: "generic" | "today_schedule" | "accomplished_today";
  };
  let phone = body.phone ? normalizePhone(body.phone) : null;

  if (!phone) {
    const { data } = await supabase.from("sms_settings").select("phone_number").eq("user_id", user.id).maybeSingle();
    phone = (data as { phone_number: string | null } | null)?.phone_number ?? null;
  }
  if (!phone) return NextResponse.json({ error: "No phone number saved yet." }, { status: 400 });

  let message = "Cadence test text — if you got this, your text notifications are wired up correctly.";
  if (body.kind === "today_schedule" || body.kind === "accomplished_today") {
    const { data: settingsRow } = await supabase.from("user_settings").select("timezone").eq("user_id", user.id).maybeSingle();
    const tz = (settingsRow as { timezone: string } | null)?.timezone || "UTC";
    const localDate = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    message =
      body.kind === "today_schedule"
        ? await buildTodayScheduleText(supabase, user.id, localDate, tz)
        : await buildAccomplishedTodayText(supabase, user.id, localDate, tz);
  }

  const result = await sendSms(phone, message);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 502 });
  return NextResponse.json({ ok: true, sid: result.sid });
}
