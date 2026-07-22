import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  getPlaidCredentials,
  plaidClientFor,
  syncPlaidItem,
  verifyPlaidWebhook,
  type PlaidItemRow,
} from "@/lib/plaid";
import { cleanupNewTransactions } from "@/lib/financeAi";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

// Events that mean "go fetch what's new right now" — covers both the modern
// Transactions Sync webhook (SYNC_UPDATES_AVAILABLE) and the older
// initial/historical/default update codes some Items can still send.
const SYNC_EVENTS = new Set([
  "SYNC_UPDATES_AVAILABLE",
  "INITIAL_UPDATE",
  "HISTORICAL_UPDATE",
  "DEFAULT_UPDATE",
  "NEW_ACCOUNTS_AVAILABLE",
]);

export async function POST(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return NextResponse.json({ error: "not_configured" }, { status: 501 });
  }
  const db = createClient(url, serviceKey, { auth: { persistSession: false } });

  const rawBody = await request.text();
  let payload: { webhook_type?: string; webhook_code?: string; item_id?: string; error?: unknown };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }

  const itemId = payload.item_id;
  if (!itemId) return NextResponse.json({ ok: true, ignored: "no item_id" });

  const { data: item } = await db.from("plaid_items").select("*").eq("item_id", itemId).maybeSingle();
  if (!item) return NextResponse.json({ ok: true, ignored: "unknown item" });
  const itemRow = item as PlaidItemRow;

  const creds = await getPlaidCredentials(db, itemRow.user_id);
  if (!creds) return NextResponse.json({ ok: true, ignored: "no credentials" });
  const client = plaidClientFor(creds);

  const signature = request.headers.get("plaid-verification") ?? "";
  const verified = await verifyPlaidWebhook(client, signature, rawBody);
  if (!verified) return NextResponse.json({ error: "bad_signature" }, { status: 401 });

  const code = payload.webhook_code ?? "";

  if (payload.webhook_type === "ITEM" && code === "ERROR") {
    const msg = (payload.error as { error_message?: string } | undefined)?.error_message ?? "Item error";
    await db.from("plaid_items").update({ status: "error", error: msg }).eq("id", itemRow.id);
    return NextResponse.json({ ok: true, handled: "item_error" });
  }

  if (SYNC_EVENTS.has(code)) {
    try {
      const result = await syncPlaidItem(db, itemRow);
      const cleaned = await cleanupNewTransactions(db, itemRow.user_id, result.transactions).catch(() => 0);
      return NextResponse.json({ ok: true, synced: result, cleaned });
    } catch (e) {
      const msg = (e as Error).message;
      await db.from("plaid_items").update({ status: "error", error: msg }).eq("id", itemRow.id);
      return NextResponse.json({ error: msg }, { status: 502 });
    }
  }

  return NextResponse.json({ ok: true, ignored: code });
}
