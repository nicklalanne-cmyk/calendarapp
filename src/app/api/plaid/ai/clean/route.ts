import { NextResponse } from "next/server";
import { requireUser } from "@/lib/google/session";
import { getFinanceAiApiKey, cleanTransactions } from "@/lib/financeAi";

export const maxDuration = 60;

// Manual "Clean up transactions" button — backfills clean_name/clean_category
// for older transactions that synced before the AI assistant was configured
// (new transactions get cleaned automatically as part of every sync). Call
// repeatedly until `remaining` comes back false.
export async function POST() {
  const { supabase, user } = await requireUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const apiKey = await getFinanceAiApiKey(supabase, user.id);
  if (!apiKey) return NextResponse.json({ error: "No AI assistant key configured yet" }, { status: 400 });

  const { data, error } = await supabase
    .from("plaid_transactions")
    .select("transaction_id, name, merchant_name, amount, category")
    .eq("user_id", user.id)
    .is("clean_name", null)
    .order("date", { ascending: false })
    .limit(60);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const batch = data ?? [];
  if (batch.length === 0) return NextResponse.json({ cleaned: 0, remaining: false });

  try {
    const results = await cleanTransactions(apiKey, batch);
    for (const r of results) {
      if (!r.transaction_id) continue;
      await supabase
        .from("plaid_transactions")
        .update({ clean_name: r.clean_name, clean_category: r.clean_category })
        .eq("transaction_id", r.transaction_id)
        .eq("user_id", user.id);
    }
    return NextResponse.json({ cleaned: results.length, remaining: batch.length === 60 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
