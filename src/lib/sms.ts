/**
 * Server-only. Sends real SMS text messages via Twilio's REST API using
 * `fetch` (no SDK needed — Twilio's Messages endpoint is a plain form-POST).
 * Never import this from a client component; it reads server-only secrets
 * (TWILIO_*) that must not reach the browser bundle.
 */
export async function sendSms(to: string, body: string): Promise<{ ok: true; sid: string } | { ok: false; error: string }> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const apiKey = process.env.TWILIO_API_KEY;
  const apiSecret = process.env.TWILIO_API_SECRET;
  const from = process.env.TWILIO_FROM_NUMBER;

  if (!accountSid || !apiKey || !apiSecret || !from) {
    return { ok: false, error: "Twilio isn't configured (missing TWILIO_ACCOUNT_SID/TWILIO_API_KEY/TWILIO_API_SECRET/TWILIO_FROM_NUMBER)." };
  }

  const params = new URLSearchParams({ To: to, From: from, Body: body });
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  const data = (await res.json().catch(() => ({}))) as { sid?: string; message?: string };
  if (!res.ok) {
    return { ok: false, error: data.message || `Twilio API ${res.status}` };
  }
  return { ok: true, sid: data.sid ?? "" };
}

/** Loose normalize to E.164 — accepts a bare 10-digit US number (what a
 * Settings phone-number field will usually contain) or an already-prefixed
 * "+1..." number, and leaves anything else (already-international) alone. */
export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) return digits;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return digits ? `+${digits}` : null;
}
