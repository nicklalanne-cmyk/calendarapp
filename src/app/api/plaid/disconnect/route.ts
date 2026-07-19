import { NextResponse } from "next/server";
import { requireUser } from "@/lib/google/session";
import { getPlaidCredentials, plaidClientFor } from "@/lib/plaid";
import type { PlaidItemRow } from "@/lib/plaid";

export async function POST(request: Request) {
  const { supabase, user } = await requireUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const itemId: string | undefined = body.item_id;
  if (!itemId) return NextResponse.json({ error: "missing item_id" }, { status: 400 });

  const { data: item, error } = await supabase
    .from("plaid_items")
    .select("*")
    .eq("id", itemId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!item) return NextResponse.json({ error: "not found" }, { status: 404 });

  const creds = await getPlaidCredentials(supabase, user.id);
  if (creds) {
    try {
      const client = plaidClientFor(creds);
      await client.itemRemove({ access_token: (item as PlaidItemRow).access_token });
    } catch {
      // Plaid-side removal failing shouldn't block removing it from Cadence —
      // worst case an orphaned item sits in their dashboard.
    }
  }

  await supabase.from("plaid_items").delete().eq("id", itemId);
  return NextResponse.json({ ok: true });
}
