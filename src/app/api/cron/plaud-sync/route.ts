import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { syncPlaudAccount, type PlaudAccountRow } from "@/lib/plaud";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Runs on a Vercel cron (hourly). For every user who's connected a Plaud
 * account (Settings -> Claude Skill's sibling "Plaud" section), checks for
 * recordings with a finished AI summary since the last check and creates a
 * Cadence Note for each one. Safe to run repeatedly — state (checkpoint +
 * pending retries) lives on the plaud_accounts row.
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

  const { data, error } = await db.from("plaud_accounts").select("*");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const accounts = (data as PlaudAccountRow[] | null) ?? [];

  const results: Record<string, unknown> = {};
  for (const account of accounts) {
    try {
      results[account.user_id] = await syncPlaudAccount(db, account);
    } catch (e) {
      results[account.user_id] = { error: (e as Error).message };
    }
  }

  return NextResponse.json({ accounts: accounts.length, results });
}
