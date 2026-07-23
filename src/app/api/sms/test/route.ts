import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/google/session";
import { sendSms, normalizePhone } from "@/lib/sms";

export const dynamic = "force-dynamic";

/** "Send test text" button in Settings — sends an immediate SMS to the
 * caller's own configured number, so they can confirm Twilio + the number
 * work without waiting for the next scheduled digest. */
export async function POST(request: NextRequest) {
  const { supabase, user } = await requireUser();
  if (!user) return NextResponse.json({ error: "not_signed_in" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as { phone?: string };
  let phone = body.phone ? normalizePhone(body.phone) : null;

  if (!phone) {
    const { data } = await supabase.from("sms_settings").select("phone_number").eq("user_id", user.id).maybeSingle();
    phone = (data as { phone_number: string | null } | null)?.phone_number ?? null;
  }
  if (!phone) return NextResponse.json({ error: "No phone number saved yet." }, { status: 400 });

  const result = await sendSms(phone, "Cadence test text — if you got this, your text notifications are wired up correctly.");
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 502 });
  return NextResponse.json({ ok: true, sid: result.sid });
}
