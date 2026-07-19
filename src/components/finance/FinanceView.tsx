"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePlaidLink } from "react-plaid-link";
import {
  Wallet,
  Plus,
  RefreshCw,
  Search,
  Repeat,
  Trash2,
  Landmark,
  AlertCircle,
  TrendingUp,
  TrendingDown,
  PiggyBank,
  ListChecks,
  Download,
  CheckCircle2,
  X,
} from "lucide-react";
import clsx from "clsx";
import { toast } from "@/lib/toast";
import { detectRecurringBills, isLiabilityAccount, type RecurringBill } from "@/lib/plaid";

type PlaidItemSummary = {
  id: string;
  institution_name: string | null;
  institution_id: string | null;
  status: string;
  error: string | null;
  updated_at: string;
};

type PlaidAccount = {
  id: string;
  item_id: string;
  account_id: string;
  name: string | null;
  official_name: string | null;
  mask: string | null;
  type: string | null;
  subtype: string | null;
  current_balance: number | null;
  available_balance: number | null;
  iso_currency_code: string | null;
};

type PlaidTransaction = {
  id: string;
  transaction_id: string;
  account_id: string;
  amount: number;
  iso_currency_code: string | null;
  date: string;
  merchant_name: string | null;
  name: string;
  category: string[] | null;
  pending: boolean;
};

type NetWorthSnapshot = { account_id: string; date: string; balance: number };
type Budget = { id: string; category: string; monthly_limit: number };

// Persists the in-progress link_token across the redirect to the bank's own
// login page and back — OAuth institutions (Chase, BofA, Wells Fargo, ...)
// leave this page entirely, so React state alone can't survive the round
// trip. Plaid's own recommended pattern for a plain web integration.
const LINK_TOKEN_LS_KEY = "cadence-plaid-link-token";

function fmtMoney(n: number | null, currency?: string | null) {
  if (n === null || n === undefined) return "—";
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: currency || "USD" }).format(n);
  } catch {
    return `$${n.toFixed(2)}`;
  }
}

function humanCategory(c: string) {
  return c
    .toLowerCase()
    .split("_")
    .map((w) => w[0]?.toUpperCase() + w.slice(1))
    .join(" ");
}

function monthKey(dateStr: string) {
  return dateStr.slice(0, 7); // YYYY-MM
}

export default function FinanceView() {
  const [items, setItems] = useState<PlaidItemSummary[]>([]);
  const [accounts, setAccounts] = useState<PlaidAccount[]>([]);
  const [transactions, setTransactions] = useState<PlaidTransaction[]>([]);
  const [netWorthSnapshots, setNetWorthSnapshots] = useState<NetWorthSnapshot[]>([]);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [loading, setLoading] = useState(true);
  const [txLoading, setTxLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [accountFilter, setAccountFilter] = useState<string | null>(null);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [addingBills, setAddingBills] = useState<Record<string, boolean>>({});
  const [budgetForm, setBudgetForm] = useState({ category: "", limit: "" });
  const [savingBudget, setSavingBudget] = useState(false);
  // Present only when we've been bounced back here from a bank's OAuth login
  // page (Plaid appends this param to the redirect_uri).
  const [isOAuthReturn, setIsOAuthReturn] = useState(false);

  // Resume an in-progress OAuth Link session on return from the bank.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!window.location.search.includes("oauth_state_id=")) return;
    const saved = localStorage.getItem(LINK_TOKEN_LS_KEY);
    if (!saved) return;
    setLinkToken(saved);
    setIsOAuthReturn(true);
    setConnecting(true);
  }, []);

  const loadAccounts = useCallback(async () => {
    const res = await fetch("/api/plaid/accounts");
    const j = await res.json();
    if (res.ok) {
      setItems(j.items ?? []);
      setAccounts(j.accounts ?? []);
    }
    setLoading(false);
  }, []);

  const loadTransactions = useCallback(
    async (opts?: { q?: string; account_id?: string; category?: string; from?: string; to?: string }) => {
      setTxLoading(true);
      const params = new URLSearchParams();
      if (opts?.q) params.set("q", opts.q);
      if (opts?.account_id) params.set("account_id", opts.account_id);
      if (opts?.category) params.set("category", opts.category);
      if (opts?.from) params.set("from", opts.from);
      if (opts?.to) params.set("to", opts.to);
      const qs = params.toString();
      const res = await fetch(`/api/plaid/transactions${qs ? `?${qs}` : ""}`);
      const j = await res.json();
      if (res.ok) setTransactions(j.transactions ?? []);
      setTxLoading(false);
    },
    []
  );

  const loadNetWorth = useCallback(async () => {
    const res = await fetch("/api/plaid/net-worth");
    const j = await res.json();
    if (res.ok) setNetWorthSnapshots(j.snapshots ?? []);
  }, []);

  const loadBudgets = useCallback(async () => {
    const res = await fetch("/api/plaid/budgets");
    const j = await res.json();
    if (res.ok) setBudgets(j.budgets ?? []);
  }, []);

  useEffect(() => {
    loadAccounts();
    loadTransactions();
    loadNetWorth();
    loadBudgets();
  }, [loadAccounts, loadTransactions, loadNetWorth, loadBudgets]);

  useEffect(() => {
    const t = setTimeout(
      () =>
        loadTransactions({
          q: search || undefined,
          account_id: accountFilter || undefined,
          category: categoryFilter || undefined,
          from: fromDate || undefined,
          to: toDate || undefined,
        }),
      300
    );
    return () => clearTimeout(t);
  }, [search, accountFilter, categoryFilter, fromDate, toDate, loadTransactions]);

  const { open, ready } = usePlaidLink({
    token: linkToken,
    ...(isOAuthReturn ? { receivedRedirectUri: typeof window !== "undefined" ? window.location.href : undefined } : {}),
    onSuccess: async (public_token, metadata) => {
      setConnecting(true);
      try {
        const res = await fetch("/api/plaid/exchange", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ public_token, institution: metadata.institution }),
        });
        const j = await res.json();
        if (!res.ok) return toast(j.error ?? "Couldn't connect that account", "error");
        toast(`Connected ${j.institution ?? "your bank"}`);
        await loadAccounts();
        await loadTransactions();
        await loadNetWorth();
      } finally {
        setConnecting(false);
        setLinkToken(null);
        setIsOAuthReturn(false);
        localStorage.removeItem(LINK_TOKEN_LS_KEY);
        // Strip ?oauth_state_id=... so a refresh doesn't try to resume again.
        window.history.replaceState({}, "", window.location.pathname);
      }
    },
    onExit: () => {
      setLinkToken(null);
      setConnecting(false);
      setIsOAuthReturn(false);
      localStorage.removeItem(LINK_TOKEN_LS_KEY);
      if (window.location.search.includes("oauth_state_id=")) {
        window.history.replaceState({}, "", window.location.pathname);
      }
    },
  });

  useEffect(() => {
    if (linkToken && ready) open();
  }, [linkToken, ready, open]);

  const startConnect = async () => {
    setConnecting(true);
    try {
      const res = await fetch("/api/plaid/link-token", { method: "POST" });
      const j = await res.json();
      if (!res.ok) {
        setConnecting(false);
        return toast(j.error ?? "Couldn't start bank connection", "error");
      }
      localStorage.setItem(LINK_TOKEN_LS_KEY, j.link_token);
      setLinkToken(j.link_token);
    } catch {
      setConnecting(false);
      toast("Couldn't start bank connection", "error");
    }
  };

  const syncNow = async () => {
    setSyncing(true);
    try {
      const res = await fetch("/api/plaid/sync", { method: "POST" });
      const j = await res.json();
      if (!res.ok) return toast(j.error ?? "Sync failed", "error");
      toast(j.reminders ? `Synced · ${j.reminders} bill reminder${j.reminders === 1 ? "" : "s"} added` : "Synced");
      await loadAccounts();
      await loadTransactions();
      await loadNetWorth();
    } finally {
      setSyncing(false);
    }
  };

  const disconnect = async (itemId: string, name: string | null) => {
    if (!confirm(`Disconnect ${name ?? "this account"}? Its transaction history stays in Cadence.`)) return;
    const res = await fetch("/api/plaid/disconnect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ item_id: itemId }),
    });
    const j = await res.json();
    if (!res.ok) return toast(j.error ?? "Couldn't disconnect", "error");
    toast("Disconnected");
    loadAccounts();
  };

  const addBillToTasks = async (b: RecurringBill) => {
    setAddingBills((s) => ({ ...s, [b.key]: true }));
    try {
      const res = await fetch("/api/plaid/bills/add-task", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: b.key, label: b.label, amount: b.amount, due_date: b.nextEstimate, cadence: b.cadence }),
      });
      const j = await res.json();
      if (!res.ok) return toast(j.error ?? "Couldn't add task", "error");
      toast(`Added "${j.task.title}" to Tasks`);
    } finally {
      setAddingBills((s) => ({ ...s, [b.key]: false }));
    }
  };

  const saveBudget = async () => {
    const category = budgetForm.category.trim();
    const limit = parseFloat(budgetForm.limit);
    if (!category || !(limit > 0)) return toast("Enter a category and a positive limit", "error");
    setSavingBudget(true);
    try {
      const res = await fetch("/api/plaid/budgets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, monthly_limit: limit }),
      });
      const j = await res.json();
      if (!res.ok) return toast(j.error ?? "Couldn't save budget", "error");
      toast("Budget saved");
      setBudgetForm({ category: "", limit: "" });
      await loadBudgets();
    } finally {
      setSavingBudget(false);
    }
  };

  const deleteBudget = async (category: string) => {
    const res = await fetch("/api/plaid/budgets", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category }),
    });
    if (!res.ok) return toast("Couldn't remove budget", "error");
    setBudgets((b) => b.filter((x) => x.category !== category));
  };

  const totalBalance = useMemo(
    () => accounts.reduce((s, a) => s + (a.current_balance ?? 0), 0),
    [accounts]
  );

  const netWorthBreakdown = useMemo(() => {
    let cash = 0;
    let investments = 0;
    let credit = 0;
    let loans = 0;
    for (const a of accounts) {
      const bal = a.current_balance ?? 0;
      if (a.type === "investment") investments += bal;
      else if (a.type === "credit") credit += bal;
      else if (a.type === "loan") loans += bal;
      else cash += bal;
    }
    const netWorth = cash + investments - credit - loans;
    return { cash, investments, credit, loans, netWorth };
  }, [accounts]);

  // Group snapshots by date, applying sign by account type, to build a
  // daily net-worth trend series for the sparkline.
  const netWorthTrend = useMemo(() => {
    const accountType = new Map(accounts.map((a) => [a.account_id, a.type]));
    const byDate = new Map<string, number>();
    for (const s of netWorthSnapshots) {
      const type = accountType.get(s.account_id) ?? null;
      const signed = isLiabilityAccount(type) ? -s.balance : s.balance;
      byDate.set(s.date, (byDate.get(s.date) ?? 0) + signed);
    }
    return Array.from(byDate.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, value]) => ({ date, value }));
  }, [netWorthSnapshots, accounts]);

  const thisMonthKey = useMemo(() => new Date().toISOString().slice(0, 7), []);

  const cashFlow = useMemo(() => {
    let income = 0;
    let spending = 0;
    for (const t of transactions) {
      if (monthKey(t.date) !== thisMonthKey) continue;
      if (t.amount < 0) income += -t.amount; // Plaid: negative amount = money in
      else spending += t.amount;
    }
    return { income, spending, net: income - spending };
  }, [transactions, thisMonthKey]);

  const spendingByCategory = useMemo(() => {
    const totals = new Map<string, number>();
    for (const t of transactions) {
      if (monthKey(t.date) !== thisMonthKey) continue;
      if (t.amount <= 0) continue; // only outflows
      const cat = t.category?.[0] ?? "Other";
      totals.set(cat, (totals.get(cat) ?? 0) + t.amount);
    }
    return Array.from(totals.entries())
      .sort(([, a], [, b]) => b - a)
      .slice(0, 8);
  }, [transactions, thisMonthKey]);

  const maxCategorySpend = spendingByCategory[0]?.[1] ?? 0;

  const budgetProgress = useMemo(() => {
    const spendByCat = new Map<string, number>();
    for (const t of transactions) {
      if (monthKey(t.date) !== thisMonthKey) continue;
      if (t.amount <= 0) continue;
      const cat = t.category?.[0] ?? "Other";
      spendByCat.set(cat, (spendByCat.get(cat) ?? 0) + t.amount);
    }
    return budgets.map((b) => ({
      ...b,
      spent: spendByCat.get(b.category) ?? 0,
      pct: Math.min(100, ((spendByCat.get(b.category) ?? 0) / b.monthly_limit) * 100),
    }));
  }, [budgets, transactions, thisMonthKey]);

  const recurring: RecurringBill[] = useMemo(() => detectRecurringBills(transactions), [transactions]);

  const sparklinePath = useMemo(() => {
    if (netWorthTrend.length < 2) return null;
    const values = netWorthTrend.map((p) => p.value);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    const w = 300;
    const h = 48;
    const pts = netWorthTrend.map((p, i) => {
      const x = (i / (netWorthTrend.length - 1)) * w;
      const y = h - ((p.value - min) / range) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    return { d: `M${pts.join(" L")}`, w, h };
  }, [netWorthTrend]);

  const exportCsvUrl = useMemo(() => {
    const params = new URLSearchParams({ format: "csv" });
    if (search) params.set("q", search);
    if (accountFilter) params.set("account_id", accountFilter);
    if (categoryFilter) params.set("category", categoryFilter);
    if (fromDate) params.set("from", fromDate);
    if (toDate) params.set("to", toDate);
    return `/api/plaid/transactions?${params.toString()}`;
  }, [search, accountFilter, categoryFilter, fromDate, toDate]);

  return (
    <div className="mx-auto h-full max-w-3xl overflow-y-auto p-4 md:p-8">
      <div className="mb-1 flex items-center justify-between">
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <Wallet className="h-6 w-6" /> Finance
        </h1>
        {items.length > 0 && (
          <button
            onClick={syncNow}
            disabled={syncing}
            className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm text-txt2 hover:bg-surface2 disabled:opacity-50"
          >
            <RefreshCw className={clsx("h-3.5 w-3.5", syncing && "animate-spin")} /> Sync now
          </button>
        )}
      </div>
      <p className="mb-6 text-sm text-txt2">
        Balances, transactions, budgets, and recurring bills from your connected bank accounts.
        Synced automatically every hour, or tap Sync now for the latest.
      </p>

      {loading ? (
        <p className="text-sm text-txt3">Loading…</p>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border py-14 text-center">
          <Landmark className="h-8 w-8 text-txt3" />
          <div>
            <p className="text-sm font-medium text-txt">No bank accounts connected yet</p>
            <p className="mt-1 text-xs text-txt3">
              Securely link a bank via Plaid — Cadence never sees your bank password.
            </p>
          </div>
          <button
            onClick={startConnect}
            disabled={connecting}
            className="mt-2 flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accentSoft disabled:opacity-50"
          >
            <Plus className="h-4 w-4" /> {connecting ? "Connecting…" : "Connect a bank account"}
          </button>
        </div>
      ) : (
        <>
          {/* net worth */}
          <div className="mb-6 rounded-xl border border-border bg-surface p-4">
            <div className="mb-1 flex items-baseline justify-between">
              <h2 className="text-sm font-semibold">Net worth</h2>
              <span className="text-lg font-semibold tabular-nums">{fmtMoney(netWorthBreakdown.netWorth)}</span>
            </div>
            {sparklinePath && (
              <svg
                viewBox={`0 0 ${sparklinePath.w} ${sparklinePath.h}`}
                className="mb-3 h-12 w-full text-accent"
                preserveAspectRatio="none"
              >
                <path d={sparklinePath.d} fill="none" stroke="currentColor" strokeWidth="2" />
              </svg>
            )}
            <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
              <div className="rounded-lg bg-surface2 p-2">
                <div className="text-txt3">Cash</div>
                <div className="mt-0.5 tabular-nums font-medium text-txt">{fmtMoney(netWorthBreakdown.cash)}</div>
              </div>
              <div className="rounded-lg bg-surface2 p-2">
                <div className="text-txt3">Investments</div>
                <div className="mt-0.5 tabular-nums font-medium text-txt">{fmtMoney(netWorthBreakdown.investments)}</div>
              </div>
              <div className="rounded-lg bg-surface2 p-2">
                <div className="text-txt3">Credit</div>
                <div className="mt-0.5 tabular-nums font-medium text-danger">{fmtMoney(netWorthBreakdown.credit)}</div>
              </div>
              <div className="rounded-lg bg-surface2 p-2">
                <div className="text-txt3">Loans</div>
                <div className="mt-0.5 tabular-nums font-medium text-danger">{fmtMoney(netWorthBreakdown.loans)}</div>
              </div>
            </div>
          </div>

          {/* cash flow this month */}
          <div className="mb-6 rounded-xl border border-border bg-surface p-4">
            <h2 className="mb-3 text-sm font-semibold">This month's cash flow</h2>
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div className="rounded-lg bg-surface2 p-2">
                <div className="flex items-center gap-1 text-txt3">
                  <TrendingUp className="h-3 w-3" /> Income
                </div>
                <div className="mt-0.5 tabular-nums font-medium text-success">{fmtMoney(cashFlow.income)}</div>
              </div>
              <div className="rounded-lg bg-surface2 p-2">
                <div className="flex items-center gap-1 text-txt3">
                  <TrendingDown className="h-3 w-3" /> Spending
                </div>
                <div className="mt-0.5 tabular-nums font-medium text-txt">{fmtMoney(cashFlow.spending)}</div>
              </div>
              <div className="rounded-lg bg-surface2 p-2">
                <div className="text-txt3">Net</div>
                <div className={clsx("mt-0.5 tabular-nums font-medium", cashFlow.net >= 0 ? "text-success" : "text-danger")}>
                  {fmtMoney(cashFlow.net)}
                </div>
              </div>
            </div>
          </div>

          {/* spending by category */}
          {spendingByCategory.length > 0 && (
            <div className="mb-6 rounded-xl border border-border bg-surface p-4">
              <h2 className="mb-3 text-sm font-semibold">Spending by category (this month)</h2>
              <div className="space-y-2">
                {spendingByCategory.map(([cat, amount]) => (
                  <button
                    key={cat}
                    onClick={() => setCategoryFilter(categoryFilter === cat ? null : cat)}
                    className="block w-full text-left"
                  >
                    <div className="mb-0.5 flex items-center justify-between text-xs">
                      <span className={clsx("text-txt2", categoryFilter === cat && "font-medium text-accent")}>
                        {humanCategory(cat)}
                      </span>
                      <span className="tabular-nums text-txt3">{fmtMoney(amount)}</span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface2">
                      <div
                        className={clsx("h-full rounded-full", categoryFilter === cat ? "bg-accent" : "bg-txt3/50")}
                        style={{ width: `${maxCategorySpend ? (amount / maxCategorySpend) * 100 : 0}%` }}
                      />
                    </div>
                  </button>
                ))}
              </div>
              {categoryFilter && (
                <button
                  onClick={() => setCategoryFilter(null)}
                  className="mt-2 flex items-center gap-1 text-xs text-txt3 hover:text-txt"
                >
                  <X className="h-3 w-3" /> Clear filter ({humanCategory(categoryFilter)})
                </button>
              )}
            </div>
          )}

          {/* budgets */}
          <div className="mb-6 rounded-xl border border-border bg-surface p-4">
            <h2 className="mb-3 flex items-center gap-1.5 text-sm font-semibold">
              <PiggyBank className="h-4 w-4" /> Budgets
            </h2>
            {budgetProgress.length > 0 && (
              <div className="mb-3 space-y-3">
                {budgetProgress.map((b) => (
                  <div key={b.id}>
                    <div className="mb-0.5 flex items-center justify-between text-xs">
                      <span className="text-txt2">{humanCategory(b.category)}</span>
                      <div className="flex items-center gap-2">
                        <span className="tabular-nums text-txt3">
                          {fmtMoney(b.spent)} / {fmtMoney(b.monthly_limit)}
                        </span>
                        <button onClick={() => deleteBudget(b.category)} className="text-txt3 hover:text-danger">
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface2">
                      <div
                        className={clsx("h-full rounded-full", b.pct >= 100 ? "bg-danger" : b.pct >= 80 ? "bg-yellow-500" : "bg-accent")}
                        style={{ width: `${b.pct}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="flex items-center gap-2">
              <input
                value={budgetForm.category}
                onChange={(e) => setBudgetForm((f) => ({ ...f, category: e.target.value }))}
                placeholder="Category (e.g. FOOD_AND_DRINK)"
                className="min-w-0 flex-1 rounded-lg border border-border bg-bg px-2 py-1.5 text-xs outline-none focus:border-accent"
              />
              <input
                value={budgetForm.limit}
                onChange={(e) => setBudgetForm((f) => ({ ...f, limit: e.target.value }))}
                placeholder="Limit"
                type="number"
                className="w-24 rounded-lg border border-border bg-bg px-2 py-1.5 text-xs outline-none focus:border-accent"
              />
              <button
                onClick={saveBudget}
                disabled={savingBudget}
                className="flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accentSoft disabled:opacity-50"
              >
                <Plus className="h-3.5 w-3.5" /> Add
              </button>
            </div>
            <p className="mt-1.5 text-[11px] text-txt3">
              Use a category like it appears below in Spending by category (e.g. FOOD_AND_DRINK, GENERAL_MERCHANDISE).
            </p>
          </div>

          {/* accounts */}
          <div className="mb-6 rounded-xl border border-border bg-surface p-4">
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="text-sm font-semibold">Accounts</h2>
              <span className="text-lg font-semibold tabular-nums">{fmtMoney(totalBalance)}</span>
            </div>
            <div className="space-y-2">
              {items.map((it) => {
                const itAccounts = accounts.filter((a) => a.item_id === it.id);
                return (
                  <div key={it.id} className="rounded-lg border border-border p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Landmark className="h-4 w-4 shrink-0 text-txt3" />
                        <span className="text-sm font-medium text-txt">
                          {it.institution_name ?? "Connected bank"}
                        </span>
                        {it.status === "error" && (
                          <span className="flex items-center gap-1 text-xs text-danger" title={it.error ?? ""}>
                            <AlertCircle className="h-3.5 w-3.5" /> Needs attention
                          </span>
                        )}
                      </div>
                      <button
                        onClick={() => disconnect(it.id, it.institution_name)}
                        className="rounded-lg p-1 text-txt3 hover:text-danger"
                        title="Disconnect"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <div className="space-y-1">
                      {itAccounts.map((a) => (
                        <button
                          key={a.id}
                          onClick={() => setAccountFilter(accountFilter === a.account_id ? null : a.account_id)}
                          className="flex w-full items-center justify-between text-sm"
                        >
                          <span className={clsx("text-txt2", accountFilter === a.account_id && "font-medium text-accent")}>
                            {a.name}
                            {a.mask ? ` ••${a.mask}` : ""}
                          </span>
                          <span className="tabular-nums text-txt">
                            {fmtMoney(a.current_balance, a.iso_currency_code)}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
            <button
              onClick={startConnect}
              disabled={connecting}
              className="mt-3 flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-txt2 hover:bg-surface2 disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" /> {connecting ? "Connecting…" : "Add another account"}
            </button>
          </div>

          {/* recurring bills */}
          {recurring.length > 0 && (
            <div className="mb-6 rounded-xl border border-border bg-surface p-4">
              <h2 className="mb-3 flex items-center gap-1.5 text-sm font-semibold">
                <Repeat className="h-4 w-4" /> Recurring bills
              </h2>
              <div className="space-y-2">
                {recurring.map((b) => (
                  <div key={b.key} className="flex items-center justify-between gap-2 text-sm">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-txt">{b.label}</div>
                      <div className="text-xs text-txt3">
                        {b.cadence} · next ~{new Date(b.nextEstimate + "T00:00:00").toLocaleDateString()}
                      </div>
                    </div>
                    <span className="shrink-0 tabular-nums text-txt2">{fmtMoney(b.amount)}</span>
                    <button
                      onClick={() => addBillToTasks(b)}
                      disabled={addingBills[b.key]}
                      className="flex shrink-0 items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs text-txt2 hover:bg-surface2 disabled:opacity-50"
                      title="Add to Tasks"
                    >
                      <CheckCircle2 className="h-3 w-3" /> {addingBills[b.key] ? "Adding…" : "Add to Tasks"}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* transactions */}
          <div className="rounded-xl border border-border bg-surface p-4">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <h2 className="mr-auto flex items-center gap-1.5 text-sm font-semibold">
                <ListChecks className="h-4 w-4" /> Transactions
              </h2>
              <a
                href={exportCsvUrl}
                className="flex items-center gap-1 rounded-lg border border-border px-2 py-1.5 text-xs text-txt2 hover:bg-surface2"
                title="Export CSV"
              >
                <Download className="h-3.5 w-3.5" /> Export
              </a>
            </div>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-txt3" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search…"
                  className="w-full rounded-lg border border-border bg-bg py-1.5 pl-7 pr-2 text-xs outline-none focus:border-accent"
                />
              </div>
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="rounded-lg border border-border bg-bg px-2 py-1.5 text-xs outline-none focus:border-accent"
              />
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="rounded-lg border border-border bg-bg px-2 py-1.5 text-xs outline-none focus:border-accent"
              />
            </div>
            {(accountFilter || categoryFilter) && (
              <div className="mb-3 flex flex-wrap gap-1.5">
                {accountFilter && (
                  <button
                    onClick={() => setAccountFilter(null)}
                    className="flex items-center gap-1 rounded-full bg-surface2 px-2 py-0.5 text-[11px] text-txt2"
                  >
                    {accounts.find((a) => a.account_id === accountFilter)?.name ?? "Account"} <X className="h-3 w-3" />
                  </button>
                )}
                {categoryFilter && (
                  <button
                    onClick={() => setCategoryFilter(null)}
                    className="flex items-center gap-1 rounded-full bg-surface2 px-2 py-0.5 text-[11px] text-txt2"
                  >
                    {humanCategory(categoryFilter)} <X className="h-3 w-3" />
                  </button>
                )}
              </div>
            )}
            {txLoading ? (
              <p className="text-sm text-txt3">Loading…</p>
            ) : transactions.length === 0 ? (
              <p className="text-sm text-txt3">No transactions yet.</p>
            ) : (
              <div className="space-y-1">
                {transactions.map((t) => (
                  <div key={t.id} className="flex items-center justify-between gap-2 py-1.5 text-sm">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-txt">{t.merchant_name || t.name}</div>
                      <div className="text-xs text-txt3">
                        {new Date(t.date + "T00:00:00").toLocaleDateString()}
                        {t.pending ? " · pending" : ""}
                        {t.category?.[0] ? ` · ${humanCategory(t.category[0])}` : ""}
                      </div>
                    </div>
                    <span
                      className={clsx(
                        "shrink-0 tabular-nums",
                        t.amount > 0 ? "text-txt" : "text-success"
                      )}
                    >
                      {t.amount > 0 ? "-" : "+"}
                      {fmtMoney(Math.abs(t.amount), t.iso_currency_code)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
