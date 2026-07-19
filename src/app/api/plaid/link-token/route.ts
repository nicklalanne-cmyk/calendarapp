import { NextResponse } from "next/server";
import { requireUser } from "@/lib/google/session";
import { getPlaidCredentials, plaidClientFor, PLAID_PRODUCTS, PLAID_COUNTRY_CODES } from "@/lib/plaid";

// Cookie-session gated — called from FinanceView right before opening Plaid
// Link. RLS already scopes plaid_credentials to the signed-in user's own row,
// but we look it up explicitly since Link needs the actual client_id/secret
// to mint a token, not just a "does a row exist" check.
export async function POST() {
  const { supabase, user } = await requireUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const creds = await getPlaidCredentials(supabase, user.id);
  if (!creds) {
    return NextResponse.json(
      { error: "No Plaid credentials stored yet. Ask Claude to connect your Plaid account." },
      { status: 501 }
    );
  }

  const client = plaidClientFor(creds);
  try {
    const res = await client.linkTokenCreate({
      user: { client_user_id: user.id },
      client_name: "Cadence",
      products: PLAID_PRODUCTS,
      country_codes: PLAID_COUNTRY_CODES,
      language: "en",
    });
    return NextResponse.json({ link_token: res.data.link_token });
  } catch (e) {
    const msg =
      (e as { response?: { data?: { error_message?: string } } }).response?.data?.error_message ??
      (e as Error).message;
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
