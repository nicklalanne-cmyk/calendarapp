import type { SupabaseClient } from "@supabase/supabase-js";
import type { SyncedTransaction } from "@/lib/plaid";

/**
 * Server-only — calls the Anthropic API directly with the user's own stored
 * key. Never import this from a client component (FinanceView.tsx included);
 * the API key must never reach the browser. Two jobs: (1) clean up cryptic
 * Plaid merchant strings into short human-readable names + categories, and
 * (2) power the Financial Planner chat assistant with a context dump of the
 * user's own accounts/budgets/transactions.
 */

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const MODEL = "claude-sonnet-4-5";

export async function getFinanceAiApiKey(db: SupabaseClient, userId: string): Promise<string | null> {
  const { data } = await db.from("finance_ai_credentials").select("api_key").eq("user_id", userId).maybeSingle();
  return data?.api_key ?? null;
}

async function callClaude(
  apiKey: string,
  system: string,
  messages: { role: "user" | "assistant"; content: string }[],
  maxTokens: number
): Promise<string> {
  const res = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, system, messages }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Claude API error ${res.status}: ${text.slice(0, 300)}`);
  }
  const json = await res.json();
  const block = (json.content as { type: string; text?: string }[] | undefined)?.find((c) => c.type === "text");
  return block?.text ?? "";
}

// --- Transaction legibility cleanup -----------------------------------

export type TransactionCleanupResult = { transaction_id: string; clean_name: string; clean_category: string };

// Cap per Claude call — keeps latency well under Vercel's function timeout
// and, more importantly, keeps the model's output short enough that it
// doesn't garble transaction_ids when echoing them back (see below).
const CLEANUP_BATCH_SIZE = 20;

export async function cleanTransactions(
  apiKey: string,
  transactions: SyncedTransaction[]
): Promise<TransactionCleanupResult[]> {
  if (transactions.length === 0) return [];
  // The model is NOT asked to echo back transaction_id — on larger batches
  // it would occasionally transcribe Plaid's long random IDs with a
  // dropped/swapped character, which silently failed every update matched
  // by that id (this is why the first version of this feature "didn't do
  // much"). Instead we rely on the model preserving input order/count
  // (explicitly instructed below) and zip the results back to the real
  // transaction_ids ourselves by array index — no id transcription, no
  // silent mismatches.
  const system = `You clean up raw bank transaction data for display in a personal finance app. For each transaction, produce:
- clean_name: a short, human-readable merchant name — strip POS/terminal codes, store numbers, city/state suffixes, processor prefixes like "SQ *", "TST*", "PAYPAL *", trailing digits, etc. (e.g. "SQ *TST-JOES PIZZA 04821" -> "Joe's Pizza", "AMAZON.COM*A1B2C3D4E" -> "Amazon").
- clean_category: a short plain-English category, 2-3 words, Title Case (e.g. "Groceries", "Ride Share", "Streaming Service", "Rent", "Coffee Shop").
Respond with ONLY a JSON array, no prose, no markdown fences, no transaction ids — just the two fields per item, in the SAME ORDER as the input array (item 1 in -> item 1 out), with exactly one output item per input item:
[{"clean_name": "...", "clean_category": "..."}]`;
  const userMsg = JSON.stringify(
    transactions.map((t) => ({
      raw_name: t.name,
      merchant_name: t.merchant_name,
      amount: t.amount,
      plaid_category: t.category?.[0] ?? null,
    }))
  );
  const text = await callClaude(apiKey, system, [{ role: "user", content: userMsg }], 4096);
  let parsed: { clean_name: string; clean_category: string }[];
  try {
    const start = text.indexOf("[");
    const end = text.lastIndexOf("]");
    if (start === -1 || end === -1) return [];
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed) || parsed.length !== transactions.length) return [];
  return parsed.map((r, i) => ({
    transaction_id: transactions[i].transaction_id,
    clean_name: r.clean_name,
    clean_category: r.clean_category,
  }));
}

async function applyCleanup(db: SupabaseClient, userId: string, batch: SyncedTransaction[], apiKey: string): Promise<number> {
  const results = await cleanTransactions(apiKey, batch);
  for (const r of results) {
    await db
      .from("plaid_transactions")
      .update({ clean_name: r.clean_name, clean_category: r.clean_category })
      .eq("transaction_id", r.transaction_id)
      .eq("user_id", userId);
  }
  return results.length;
}

/** Cleans whatever transactions a sync just added/modified, if the user has
 * an AI key configured. Called after every sync (cron/webhook/manual), same
 * pattern as checkBillReminders — best-effort, never throws. */
export async function cleanupNewTransactions(
  db: SupabaseClient,
  userId: string,
  transactions: SyncedTransaction[]
): Promise<number> {
  if (transactions.length === 0) return 0;
  const apiKey = await getFinanceAiApiKey(db, userId);
  if (!apiKey) return 0;
  try {
    return await applyCleanup(db, userId, transactions.slice(0, CLEANUP_BATCH_SIZE), apiKey);
  } catch {
    return 0;
  }
}

/** Manual backfill batch size — matches CLEANUP_BATCH_SIZE so a single
 * "Clean up" click stays fast and reliable; the caller loops via the
 * `remaining` flag for older histories. */
export const MANUAL_CLEANUP_BATCH_SIZE = CLEANUP_BATCH_SIZE;

export async function cleanupTransactionBatch(
  db: SupabaseClient,
  userId: string,
  batch: { transaction_id: string; name: string; merchant_name: string | null; amount: number; category: string[] | null }[]
): Promise<number> {
  const apiKey = await getFinanceAiApiKey(db, userId);
  if (!apiKey) throw new Error("No AI assistant key configured yet");
  return applyCleanup(db, userId, batch, apiKey);
}

// --- Financial planner chat assistant -----------------------------------

/** Builds a context dump of the signed-in user's own Finance data (accounts,
 * budgets, net worth, recent transactions, recurring bills) for the chat
 * assistant's system prompt. Everything here is already RLS-scoped to the
 * caller, so this never crosses users. */
export async function buildFinanceContext(db: SupabaseClient, userId: string): Promise<string> {
  const [{ data: accounts }, { data: budgets }, { data: transactions }] = await Promise.all([
    db.from("plaid_accounts").select("name, type, subtype, current_balance, iso_currency_code").eq("user_id", userId),
    db.from("plaid_budgets").select("category, monthly_limit").eq("user_id", userId),
    db
      .from("plaid_transactions")
      .select("date, name, merchant_name, clean_name, clean_category, category, amount, pending")
      .eq("user_id", userId)
      .order("date", { ascending: false })
      .limit(200),
  ]);

  const accts = accounts ?? [];
  const cash = accts.filter((a) => a.type !== "investment" && a.type !== "credit" && a.type !== "loan");
  const investments = accts.filter((a) => a.type === "investment");
  const liabilities = accts.filter((a) => a.type === "credit" || a.type === "loan");
  const netWorth =
    accts.reduce((s, a) => s + (a.current_balance ?? 0), 0) -
    2 * liabilities.reduce((s, a) => s + (a.current_balance ?? 0), 0);

  const lines: string[] = [];
  lines.push(`Today's date: ${new Date().toISOString().slice(0, 10)}`);
  lines.push(`\nAccounts (${accts.length}):`);
  for (const a of accts) {
    lines.push(`- ${a.name} (${a.type}${a.subtype ? `/${a.subtype}` : ""}): ${a.current_balance ?? "?"} ${a.iso_currency_code ?? "USD"}`);
  }
  lines.push(`\nApproximate net worth (cash + investments - credit/loan balances): ${netWorth.toFixed(2)}`);
  lines.push(`Cash accounts: ${cash.length}, Investment accounts: ${investments.length}, Credit/loan accounts: ${liabilities.length}`);

  lines.push(`\nBudgets (${budgets?.length ?? 0}):`);
  for (const b of budgets ?? []) lines.push(`- ${b.category}: $${b.monthly_limit}/month limit`);

  lines.push(`\nMost recent transactions (up to 200, newest first):`);
  for (const t of transactions ?? []) {
    const label = t.clean_name || t.merchant_name || t.name;
    const cat = t.clean_category || t.category?.[0] || "Uncategorized";
    lines.push(`- ${t.date} | ${label} | ${cat} | ${t.amount > 0 ? "-" : "+"}$${Math.abs(t.amount).toFixed(2)}${t.pending ? " (pending)" : ""}`);
  }

  return lines.join("\n");
}

export async function askFinancialAssistant(
  apiKey: string,
  context: string,
  history: { role: "user" | "assistant"; content: string }[]
): Promise<string> {
  const system = `You are Nick's personal financial planner assistant, embedded in the Finance page of Cadence, his daily planner app. You have access to his real account balances, budgets, and recent transactions below — use them to answer questions, spot trends, flag overspending, and give clear, specific, practical budgeting and financial-planning advice. Be concise and conversational, cite real numbers from the data given, and never invent figures you weren't given. If something isn't in the data, say so instead of guessing.

--- Nick's current financial data ---
${context}`;
  return callClaude(apiKey, system, history, 1200);
}
