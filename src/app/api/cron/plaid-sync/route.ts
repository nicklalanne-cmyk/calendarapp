import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { syncPlaidItem, type PlaidItemRow } from "@/lib/plaid";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Runs on a Vercel cron (hourly, same cadence as Plaud). Syncs every
 * connected Plaid item across all users — right now that's just Nick's, but
 * this scales to more users/banks without changes. Safe to run repeatedly:
 * transactionsSync's cursor means a re-run just picks up new activity.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (secret && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return NextResponse.json(
      { error: "Cron isn't configured. Needs SUPABASE_SERVICE_ROLE_KEY." },
      { status: 501 }
    );
  }

  const db = createClient(url, serviceKey, { auth: { persistSession: false } });

  const { data, error } = await db.from("plaid_items").select("*");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const items = (data as PlaidItemRow[] | null) ?? [];

  const results: Record<string, unknown> = {};
  for (const item of items) {
    try {
      results[item.item_id] = await syncPlaidItem(db, item);
    } catch (e) {
      const msg = (e as Error).message;
      results[item.item_id] = { error: msg };
      await db.from("plaid_items").update({ status: "error", error: msg }).eq("id", item.id);
    }
  }

  return NextResponse.json({ items: items.length, results });
}
