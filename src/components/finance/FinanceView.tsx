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
} from "lucide-react";
import clsx from "clsx";
import { toast } from "@/lib/toast";
import { detectRecurringBills, type RecurringBill } from "@/lib/plaid";

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

export default function FinanceView() {
  const [items, setItems] = useState<PlaidItemSummary[]>([]);
  const [accounts, setAccounts] = useState<PlaidAccount[]>([]);
  const [transactions, setTransactions] = useState<PlaidTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [txLoading, setTxLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [search, setSearch] = useState("");
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

  const loadTransactions = useCallback(async (q?: string) => {
    setTxLoading(true);
    const res = await fetch(`/api/plaid/transactions${q ? `?q=${encodeURIComponent(q)}` : ""}`);
    const j = await res.json();
    if (res.ok) setTransactions(j.transactions ?? []);
    setTxLoading(false);
  }, []);

  useEffect(() => {
    loadAccounts();
    loadTransactions();
  }, [loadAccounts, loadTransactions]);

  useEffect(() => {
    const t = setTimeout(() => loadTransactions(search || undefined), 300);
    return () => clearTimeout(t);
  }, [search, loadTransactions]);

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
        await loadTransactions(search || undefined);
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
      toast("Synced");
      await loadAccounts();
      await loadTransactions(search || undefined);
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

  const totalBalance = useMemo(
    () => accounts.reduce((s, a) => s + (a.current_balance ?? 0), 0),
    [accounts]
  );

  const recurring: RecurringBill[] = useMemo(() => detectRecurringBills(transactions), [transactions]);

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
        Balances, transactions, and recurring bills from your connected bank accounts. Synced
        automatically every hour, or tap Sync now for the latest.
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
                        <div key={a.id} className="flex items-center justify-between text-sm">
                          <span className="text-txt2">
                            {a.name}
                            {a.mask ? ` ••${a.mask}` : ""}
                          </span>
                          <span className="tabular-nums text-txt">
                            {fmtMoney(a.current_balance, a.iso_currency_code)}
                          </span>
                        </div>
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
                  <div key={b.key} className="flex items-center justify-between text-sm">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-txt">{b.label}</div>
                      <div className="text-xs text-txt3">
                        {b.cadence} · next ~{new Date(b.nextEstimate + "T00:00:00").toLocaleDateString()}
                      </div>
                    </div>
                    <span className="shrink-0 tabular-nums text-txt2">{fmtMoney(b.amount)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* transactions */}
          <div className="rounded-xl border border-border bg-surface p-4">
            <div className="mb-3 flex items-center gap-2">
              <h2 className="text-sm font-semibold">Transactions</h2>
              <div className="relative ml-auto w-full max-w-[220px]">
                <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-txt3" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search…"
                  className="w-full rounded-lg border border-border bg-bg py-1.5 pl-7 pr-2 text-xs outline-none focus:border-accent"
                />
              </div>
            </div>
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
                        {t.category?.[0] ? ` · ${t.category[0]}` : ""}
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
