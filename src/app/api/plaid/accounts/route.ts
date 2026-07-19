import { NextResponse } from "next/server";
import { requireUser } from "@/lib/google/session";

export async function GET() {
  const { supabase, user } = await requireUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { data: items, error: itemsError } = await supabase
    .from("plaid_items")
    .select("id, institution_name, institution_id, status, error, updated_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });
  if (itemsError) return NextResponse.json({ error: itemsError.message }, { status: 500 });

  const { data: accounts, error: accountsError } = await supabase
    .from("plaid_accounts")
    .select("*")
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false });
  if (accountsError) return NextResponse.json({ error: accountsError.message }, { status: 500 });

  return NextResponse.json({ items: items ?? [], accounts: accounts ?? [] });
}
