import { NextResponse } from "next/server";
import { requireUser } from "@/lib/google/session";
import { cleanupTransactionBatch, MANUAL_CLEANUP_BATCH_SIZE } from "@/lib/financeAi";

export const maxDuration = 60;

// Manual "Clean up transactions" button — backfills clean_name/clean_category
// for older transactions that synced before the AI assistant was configured
// (new transactions get cleaned automatically as part of every sync). Call
// repeatedly until `remaining` comes back false.
export async function POST() {
  const { supabase, user } = await requireUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { data, error } = await supabase
    .from("plaid_transactions")
    .select("transaction_id, name, merchant_name, amount, category")
    .eq("user_id", user.id)
    .is("clean_name", null)
    .order("date", { ascending: false })
    .limit(MANUAL_CLEANUP_BATCH_SIZE);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const batch = data ?? [];
  if (batch.length === 0) return NextResponse.json({ cleaned: 0, remaining: false });

  try {
    const cleaned = await cleanupTransactionBatch(supabase, user.id, batch);
    return NextResponse.json({ cleaned, remaining: batch.length === MANUAL_CLEANUP_BATCH_SIZE });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
