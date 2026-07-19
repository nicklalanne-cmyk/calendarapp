import { NextResponse } from "next/server";
import { requireUser } from "@/lib/google/session";
import { syncPlaidItem, type PlaidItemRow } from "@/lib/plaid";

// Manual "Sync now" button in the Finance page. RLS already scopes
// plaid_items to the signed-in user, so this only ever touches their own
// connected banks.
export async function POST() {
  const { supabase, user } = await requireUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { data, error } = await supabase.from("plaid_items").select("*").eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const items = (data as PlaidItemRow[] | null) ?? [];
  if (items.length === 0) {
    return NextResponse.json({ error: "No bank accounts connected yet" }, { status: 400 });
  }

  const results: Record<string, unknown> = {};
  let anyError = false;
  for (const item of items) {
    try {
      results[item.institution_name ?? item.item_id] = await syncPlaidItem(supabase, item);
    } catch (e) {
      anyError = true;
      const msg = (e as Error).message;
      results[item.institution_name ?? item.item_id] = { error: msg };
      await supabase.from("plaid_items").update({ status: "error", error: msg }).eq("id", item.id);
    }
  }

  return NextResponse.json({ ok: !anyError, results });
}
