"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Star, Trash2, Link2 } from "lucide-react";
import type { ConnectedAccount } from "@/lib/types";

export default function AccountsView() {
  const [accounts, setAccounts] = useState<ConnectedAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/google/accounts");
    const json = (await res.json()) as { accounts?: ConnectedAccount[] };
    setAccounts(json.accounts ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const params = new URLSearchParams(window.location.search);
    if (params.get("connected")) setMessage("Google account connected.");
    else if (params.get("error") === "no_refresh")
      setMessage("Couldn't get offline access — try again and be sure to allow calendar access.");
    else if (params.get("error")) setMessage("Something went wrong connecting that account.");
    if (params.toString()) window.history.replaceState({}, "", "/app/accounts");
  }, [load]);

  const connect = () => {
    window.location.href = "/api/google/connect";
  };

  const makeDefault = async (id: string) => {
    await fetch(`/api/google/accounts/${id}`, { method: "PATCH" });
    load();
  };
  const disconnect = async (id: string) => {
    await fetch(`/api/google/accounts/${id}`, { method: "DELETE" });
    load();
  };

  return (
    <div className="mx-auto h-full max-w-2xl overflow-y-auto p-4 md:p-8">
      <h1 className="text-2xl font-semibold">Connected calendars</h1>
      <p className="mt-2 text-sm text-txt2">
        Connect one or more Google accounts. Cadence imports the calendars you have visible in each,
        and new events you create are added to your <span className="text-txt">default</span> account.
      </p>

      {message && (
        <div className="mt-4 rounded-lg border border-border bg-surface px-4 py-2 text-sm text-txt2">
          {message}
        </div>
      )}

      <button
        onClick={connect}
        className="mt-6 flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-white hover:bg-accentSoft"
      >
        <Plus className="h-4 w-4" /> Add Google account
      </button>

      <div className="mt-6 space-y-2">
        {loading ? (
          <p className="text-sm text-txt3">Loading…</p>
        ) : accounts.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border py-10 text-center">
            <Link2 className="h-6 w-6 text-txt3" />
            <p className="text-sm text-txt3">No accounts connected yet.</p>
          </div>
        ) : (
          accounts.map((a) => (
            <div
              key={a.id}
              className="flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-surface3 text-xs font-semibold uppercase text-txt2">
                {a.google_email.slice(0, 1)}
              </div>
              <div className="flex-1">
                <div className="text-sm">{a.google_email}</div>
                {a.is_default && (
                  <div className="flex items-center gap-1 text-xs text-accent">
                    <Star className="h-3 w-3 fill-accent" /> Default for new events
                  </div>
                )}
              </div>
              {!a.is_default && (
                <button
                  onClick={() => makeDefault(a.id)}
                  className="rounded-md border border-border px-2.5 py-2 text-xs text-txt2 active:bg-surface2 md:py-1"
                >
                  Make default
                </button>
              )}
              <button
                onClick={() => disconnect(a.id)}
                aria-label="Disconnect"
                title="Disconnect"
                className="flex h-9 w-9 items-center justify-center rounded-md text-txt3 active:bg-surface2 hover:text-danger md:h-auto md:w-auto md:p-1"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))
        )}
      </div>

      <p className="mt-8 text-xs text-txt3">
        Because this app is in Google "testing" mode, each account you connect must be added as a
        Test user on the app's OAuth consent screen first.
      </p>
    </div>
  );
}
