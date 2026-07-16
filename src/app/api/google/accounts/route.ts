import { NextResponse } from "next/server";
import { requireUser } from "@/lib/google/session";
import { getGoogleAccessToken } from "@/lib/google/tokens";

export const dynamic = "force-dynamic";

export async function GET() {
  const { supabase, user } = await requireUser();
  if (!user) return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  const { data } = await supabase
    .from("google_accounts")
    .select("id, google_email, is_default, refresh_token")
    .order("created_at", { ascending: true });
  const rows = data ?? [];
  // A broken/expired connection previously looked identical to a healthy one
  // in the Accounts list — the only sign was calendar events from that
  // account quietly disappearing. Refreshing the token here (same call the
  // sync path already makes) surfaces that state directly instead.
  const accounts = await Promise.all(
    rows.map(async (r) => {
      const token = await getGoogleAccessToken(r.refresh_token);
      return { id: r.id, google_email: r.google_email, is_default: r.is_default, healthy: Boolean(token) };
    })
  );
  return NextResponse.json({ accounts });
}
