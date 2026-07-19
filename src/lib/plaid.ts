import { Configuration, PlaidApi, PlaidEnvironments, Products, CountryCode } from "plaid";
import type { SupabaseClient } from "@supabase/supabase-js";
import crypto from "crypto";

export type PlaidCredentialsRow = {
  user_id: string;
  client_id: string;
  secret: string;
  env: "sandbox" | "production";
};

export type PlaidItemRow = {
  id: string;
  user_id: string;
  item_id: string;
  access_token: string;
  institution_id: string | null;
  institution_name: string | null;
  cursor: string | null;
  status: string;
  error: string | null;
};

/** Server-only. Builds a Plaid API client scoped to whatever environment the
 * user's stored credentials belong to — sandbox by default until they swap
 * in real production keys from their own Plaid dashboard, at which point
 * this picks it up automatically with no code change (same "activates
 * itself the moment credentials are saved" pattern as the Pocket AI
 * webhook). */
export function plaidClientFor(creds: Pick<PlaidCredentialsRow, "client_id" | "secret" | "env">) {
  const basePath =
    creds.env === "production" ? PlaidEnvironments.production : PlaidEnvironments.sandbox;
  const configuration = new Configuration({
    basePath,
    baseOptions: {
      headers: {
        "PLAID-CLIENT-ID": creds.client_id,
        "PLAID-SECRET": creds.secret,
      },
    },
  });
  return new PlaidApi(configuration);
}

export async function getPlaidCredentials(
  db: SupabaseClient,
  userId: string
): Promise<PlaidCredentialsRow | null> {
  const { data } = await db.from("plaid_credentials").select("*").eq("user_id", userId).maybeSingle();
  return (data as PlaidCredentialsRow | null) ?? null;
}

export const PLAID_PRODUCTS = [Products.Transactions];
export const PLAID_COUNTRY_CODES = [CountryCode.Us];
export const PLAID_WEBHOOK_URL = "https://cadenceplanner.app/api/webhooks/plaid";

// Verification keys are stable and cheap to reuse across invocations of a
// warm serverless instance — no need to re-fetch per request.
const webhookKeyCache = new Map<string, string>();

/** Verifies a Plaid webhook's `Plaid-Verification` JWT header against the
 * raw request body, per Plaid's documented verification flow: decode the
 * JWT header to find which key signed it, fetch (and cache) that public key,
 * check the signature, reject anything older than 5 minutes (replay
 * protection), and confirm the body hash in the JWT payload matches the
 * actual raw body Plaid sent us. */
export async function verifyPlaidWebhook(
  client: PlaidApi,
  jwt: string,
  rawBody: string
): Promise<boolean> {
  try {
    const [headerB64, payloadB64, sigB64] = jwt.split(".");
    if (!headerB64 || !payloadB64 || !sigB64) return false;

    const header = JSON.parse(Buffer.from(headerB64, "base64url").toString("utf8"));
    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
    if (header.alg !== "ES256") return false;

    const kid: string = header.kid;
    let jwkPem = webhookKeyCache.get(kid);
    if (!jwkPem) {
      const res = await client.webhookVerificationKeyGet({ key_id: kid });
      const jwk = res.data.key as unknown as crypto.JsonWebKey;
      jwkPem = crypto.createPublicKey({ key: jwk, format: "jwk" }).export({ type: "spki", format: "pem" }).toString();
      webhookKeyCache.set(kid, jwkPem);
    }

    // Replay protection — reject anything older than 5 minutes.
    if (typeof payload.iat !== "number" || Date.now() / 1000 - payload.iat > 300) return false;

    const signature = Buffer.from(sigB64, "base64url");
    const signedData = `${headerB64}.${payloadB64}`;
    const verified = crypto.verify(
      "sha256",
      Buffer.from(signedData),
      { key: jwkPem, dsaEncoding: "ieee-p1363" },
      signature
    );
    if (!verified) return false;

    const bodyHash = crypto.createHash("sha256").update(rawBody).digest("hex");
    return bodyHash === payload.request_body_sha256;
  } catch {
    return false;
  }
}

/** Pulls every account + transaction change since the item's stored cursor
 * (Plaid's /transactions/sync, paginated via has_more) and upserts into
 * plaid_accounts / plaid_transactions. Safe to call repeatedly — cursor
 * persistence means a re-run just picks up where it left off. Used by both
 * the manual "Sync now" route and the hourly cron. */
export async function syncPlaidItem(db: SupabaseClient, item: PlaidItemRow) {
  const creds = await getPlaidCredentials(db, item.user_id);
  if (!creds) throw new Error("no Plaid credentials stored for this user");
  const client = plaidClientFor(creds);

  // Refresh account balances every sync — cheap, and keeps the summary cards
  // accurate even on syncs where nothing transactional changed.
  const accountsRes = await client.accountsGet({ access_token: item.access_token });
  for (const acc of accountsRes.data.accounts) {
    await db.from("plaid_accounts").upsert(
      {
        user_id: item.user_id,
        item_id: item.id,
        account_id: acc.account_id,
        name: acc.name,
        official_name: acc.official_name,
        mask: acc.mask,
        type: acc.type,
        subtype: acc.subtype,
        current_balance: acc.balances.current,
        available_balance: acc.balances.available,
        iso_currency_code: acc.balances.iso_currency_code,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "account_id" }
    );
  }

  let cursor = item.cursor ?? undefined;
  let hasMore = true;
  let added = 0;
  let modified = 0;
  let removed = 0;

  while (hasMore) {
    const res = await client.transactionsSync({
      access_token: item.access_token,
      cursor,
      count: 500,
    });
    const page = res.data;

    for (const t of [...page.added, ...page.modified]) {
      await db.from("plaid_transactions").upsert(
        {
          user_id: item.user_id,
          item_id: item.id,
          account_id: t.account_id,
          transaction_id: t.transaction_id,
          amount: t.amount,
          iso_currency_code: t.iso_currency_code,
          date: t.date,
          authorized_date: t.authorized_date,
          merchant_name: t.merchant_name ?? null,
          name: t.name,
          category: t.personal_finance_category?.primary ? [t.personal_finance_category.primary] : t.category ?? null,
          pending: t.pending,
          payment_channel: t.payment_channel,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "transaction_id" }
      );
    }
    added += page.added.length;
    modified += page.modified.length;

    for (const r of page.removed) {
      if (!r.transaction_id) continue;
      await db.from("plaid_transactions").delete().eq("transaction_id", r.transaction_id);
      removed++;
    }

    cursor = page.next_cursor;
    hasMore = page.has_more;
  }

  await db
    .from("plaid_items")
    .update({ cursor, status: "good", error: null, updated_at: new Date().toISOString() })
    .eq("id", item.id);

  return { accounts: accountsRes.data.accounts.length, added, modified, removed };
}

/** Groups recent transactions by merchant + rounded amount, flags anything
 * that recurs on a roughly regular cadence (weekly/biweekly/monthly) as a
 * likely bill/subscription, and predicts the next date from the average gap.
 * Pure client-side heuristic — no extra API calls, recomputed on the fly
 * from whatever transactions are already loaded. */
export type RecurringBill = {
  key: string;
  label: string;
  amount: number;
  cadence: "weekly" | "biweekly" | "monthly" | "irregular";
  occurrences: number;
  lastDate: string;
  nextEstimate: string | null;
};

export function detectRecurringBills(
  transactions: { name: string; merchant_name: string | null; amount: number; date: string; pending: boolean }[]
): RecurringBill[] {
  const groups = new Map<string, { amount: number; dates: string[] }>();
  for (const t of transactions) {
    if (t.pending) continue;
    if (t.amount <= 0) continue; // Plaid convention: positive = money out
    const label = (t.merchant_name || t.name || "").trim();
    if (!label) continue;
    const key = `${label.toLowerCase()}|${Math.round(t.amount)}`;
    const g = groups.get(key);
    if (g) g.dates.push(t.date);
    else groups.set(key, { amount: t.amount, dates: [t.date] });
  }

  const bills: RecurringBill[] = [];
  for (const [key, g] of groups) {
    if (g.dates.length < 2) continue;
    const dates = [...g.dates].sort();
    const gapsDays = dates.slice(1).map((d, i) => {
      const a = new Date(dates[i]).getTime();
      const b = new Date(d).getTime();
      return Math.round((b - a) / 86400000);
    });
    const avgGap = gapsDays.reduce((s, x) => s + x, 0) / gapsDays.length;
    const spread = Math.max(...gapsDays) - Math.min(...gapsDays);

    let cadence: RecurringBill["cadence"] = "irregular";
    if (spread <= 4) {
      if (avgGap >= 5 && avgGap <= 9) cadence = "weekly";
      else if (avgGap >= 12 && avgGap <= 16) cadence = "biweekly";
      else if (avgGap >= 26 && avgGap <= 35) cadence = "monthly";
    }
    if (cadence === "irregular") continue;

    const lastDate = dates[dates.length - 1];
    const nextEstimate = new Date(new Date(lastDate).getTime() + avgGap * 86400000)
      .toISOString()
      .slice(0, 10);
    const label = key.split("|")[0];
    bills.push({
      key,
      label: label.replace(/\b\w/g, (c) => c.toUpperCase()),
      amount: g.amount,
      cadence,
      occurrences: dates.length,
      lastDate,
      nextEstimate,
    });
  }

  return bills.sort((a, b) => (a.nextEstimate ?? "").localeCompare(b.nextEstimate ?? ""));
}
