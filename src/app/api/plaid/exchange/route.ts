import { NextResponse } from "next/server";
import { requireUser } from "@/lib/google/session";
import { getPlaidCredentials, plaidClientFor, syncPlaidItem, type PlaidItemRow } from "@/lib/plaid";

// Finishes the Plaid Link flow: exchanges the short-lived public_token
// Link handed back to the browser for a permanent access_token, stores the
// new item, then runs an immediate sync so accounts/transactions show up
// without waiting for the next hourly cron.
export async function POST(request: Request) {
  const { supabase, user } = await requireUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const publicToken: string | undefined = body.public_token;
  const institutionName: string | undefined = body.institution?.name;
  const institutionId: string | undefined = body.institution?.institution_id;
  if (!publicToken) return NextResponse.json({ error: "missing public_token" }, { status: 400 });

  const creds = await getPlaidCredentials(supabase, user.id);
  if (!creds) return NextResponse.json({ error: "No Plaid credentials stored" }, { status: 501 });
  const client = plaidClientFor(creds);

  try {
    const exchange = await client.itemPublicTokenExchange({ public_token: publicToken });
    const { access_token, item_id } = exchange.data;

    const { data: row, error } = await supabase
      .from("plaid_items")
      .insert({
        user_id: user.id,
        item_id,
        access_token,
        institution_id: institutionId ?? null,
        institution_name: institutionName ?? null,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);

    const result = await syncPlaidItem(supabase, row as PlaidItemRow);
    return NextResponse.json({ ok: true, institution: institutionName ?? "your bank", ...result });
  } catch (e) {
    const msg =
      (e as { response?: { data?: { error_message?: string } } }).response?.data?.error_message ??
      (e as Error).message;
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
