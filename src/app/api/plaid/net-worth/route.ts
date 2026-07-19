import { NextResponse } from "next/server";
import { requireUser } from "@/lib/google/session";

// Daily net-worth series (sum of every account's balance snapshot per day,
// liabilities included as-is — the caller subtracts based on account type)
// for the last 90 days, used to draw the trend sparkline. One row per
// account per day, so the client groups by date.
export async function GET() {
  const { supabase, user } = await requireUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const since = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from("plaid_balance_snapshots")
    .select("account_id, date, balance")
    .eq("user_id", user.id)
    .gte("date", since)
    .order("date", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ snapshots: data ?? [] });
}
