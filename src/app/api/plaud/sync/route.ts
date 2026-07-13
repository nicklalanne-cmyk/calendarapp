import { NextResponse } from "next/server";
import { requireUser } from "@/lib/google/session";
import { syncPlaudAccount, type PlaudAccountRow } from "@/lib/plaud";

// Cookie-session gated (called from the browser's Settings page "Re-Sync
// now" button), unlike the hourly cron which uses the service-role client.
// RLS on plaud_accounts already scopes this to the signed-in user's own row.

export async function GET() {
  const { supabase, user } = await requireUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { data } = await supabase
    .from("plaud_accounts")
    .select("user_id,last_synced_created_at,pending,updated_at")
    .eq("user_id", user.id)
    .maybeSingle();

  return NextResponse.json({ account: data ?? null });
}

export async function POST() {
  const { supabase, user } = await requireUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { data, error } = await supabase
    .from("plaud_accounts")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) {
    return NextResponse.json({ error: "No Plaud account connected." }, { status: 400 });
  }

  try {
    const result = await syncPlaudAccount(supabase, data as PlaudAccountRow);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
