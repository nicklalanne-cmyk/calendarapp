"use client";

import { useCallback, useEffect, useState } from "react";
import { Mic, RefreshCw, Sparkles, ChevronDown, ChevronUp } from "lucide-react";
import clsx from "clsx";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/lib/toast";
import type { Note } from "@/lib/types";

type PlaudAccount = { last_synced_created_at: string | null; pending: Record<string, string>; updated_at: string };

export default function PlaudView() {
  const supabase = createClient();
  const [account, setAccount] = useState<PlaudAccount | null>(null);
  const [accountLoading, setAccountLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [notes, setNotes] = useState<Note[]>([]);
  const [notesLoading, setNotesLoading] = useState(true);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [cleaning, setCleaning] = useState<Record<string, boolean>>({});

  const loadNotes = useCallback(async () => {
    const { data } = await supabase
      .from("notes")
      .select("*")
      .eq("source", "plaud")
      .is("deleted_at", null)
      .order("note_date", { ascending: false, nullsFirst: false })
      .order("updated_at", { ascending: false });
    setNotes((data as Note[]) ?? []);
    setNotesLoading(false);
  }, [supabase]);

  useEffect(() => {
    fetch("/api/plaud/sync")
      .then((r) => r.json())
      .then((j) => setAccount(j.account ?? null))
      .catch(() => {})
      .finally(() => setAccountLoading(false));
    loadNotes();
  }, [loadNotes]);

  const resync = async () => {
    setSyncing(true);
    try {
      const res = await fetch("/api/plaud/sync", { method: "POST" });
      const j = await res.json();
      if (!res.ok) return toast(j.error ?? "Sync failed", "error");
      toast(j.created > 0 ? `Synced — ${j.created} new note${j.created === 1 ? "" : "s"} added` : "Synced — nothing new");
      const status = await fetch("/api/plaud/sync").then((r) => r.json());
      setAccount(status.account ?? null);
      if (j.created > 0) loadNotes();
    } finally {
      setSyncing(false);
    }
  };

  const cleanUp = async (noteId: string) => {
    setCleaning((c) => ({ ...c, [noteId]: true }));
    try {
      const res = await fetch("/api/ai/clean-note", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ noteId }),
      });
      const j = await res.json();
      if (!res.ok) return toast(j.error ?? "Clean-up failed", "error");
      setNotes((prev) => prev.map((n) => (n.id === noteId ? { ...n, body: j.body } : n)));
      toast("Cleaned up");
    } finally {
      setCleaning((c) => ({ ...c, [noteId]: false }));
    }
  };

  const pendingCount = Object.keys(account?.pending ?? {}).length;

  return (
    <div className="mx-auto h-full max-w-2xl overflow-y-auto p-4 md:p-8">
      <h1 className="flex items-center gap-2 text-2xl font-semibold">
        <Mic className="h-6 w-6" /> Plaud
      </h1>
      <p className="mt-2 text-sm text-txt2">
        Recordings from your connected Plaud account are checked hourly, and each one with a
        finished AI summary is added here as a note automatically.
      </p>

      <div className="mt-6 flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3">
        <Mic className="h-5 w-5 shrink-0 text-txt3" />
        <div className="min-w-0 flex-1">
          {accountLoading ? (
            <div className="text-sm text-txt3">Loading…</div>
          ) : account ? (
            <>
              <div className="text-sm text-txt">Connected</div>
              <div className="text-xs text-txt3">
                {account.last_synced_created_at
                  ? `Last checkpoint ${new Date(account.last_synced_created_at).toLocaleDateString()}`
                  : "Not synced yet"}
                {pendingCount > 0 ? ` · ${pendingCount} recording(s) awaiting a Plaud summary` : ""}
              </div>
            </>
          ) : (
            <div className="text-sm text-txt3">Not connected yet — ask Claude to connect your Plaud account.</div>
          )}
        </div>
        {account && (
          <button
            onClick={resync}
            disabled={syncing}
            className="flex shrink-0 items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white hover:bg-accentSoft disabled:opacity-50"
          >
            <RefreshCw className={clsx("h-4 w-4", syncing && "animate-spin")} /> Re-Sync now
          </button>
        )}
      </div>

      <div className="mt-6 space-y-3">
        {notesLoading ? (
          <p className="text-sm text-txt3">Loading notes…</p>
        ) : notes.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border py-10 text-center">
            <Mic className="h-6 w-6 text-txt3" />
            <p className="text-sm text-txt3">No Plaud notes yet.</p>
          </div>
        ) : (
          notes.map((n) => {
            const isOpen = !!expanded[n.id];
            const isCleaning = !!cleaning[n.id];
            const displayTitle = n.title.replace(/^Plaud:\s*/, "");
            return (
              <div key={n.id} className="rounded-xl border border-border bg-surface p-4">
                <button
                  className="flex w-full items-start justify-between gap-3 text-left"
                  onClick={() => setExpanded((e) => ({ ...e, [n.id]: !isOpen }))}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-txt">{displayTitle}</div>
                    <div className="text-xs text-txt3">
                      {n.note_date ? new Date(n.note_date + "T00:00:00").toLocaleDateString() : "Undated"}
                    </div>
                  </div>
                  {isOpen ? (
                    <ChevronUp className="h-4 w-4 shrink-0 text-txt3" />
                  ) : (
                    <ChevronDown className="h-4 w-4 shrink-0 text-txt3" />
                  )}
                </button>

                {isOpen && (
                  <>
                    <div className="mt-3 whitespace-pre-wrap text-sm text-txt2">{n.body}</div>
                    <button
                      onClick={() => cleanUp(n.id)}
                      disabled={isCleaning}
                      className="mt-3 flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-txt2 hover:bg-surface2 disabled:opacity-50"
                    >
                      <Sparkles className={clsx("h-3.5 w-3.5", isCleaning && "animate-pulse")} />
                      {isCleaning ? "Cleaning up…" : "Claude Clean Up"}
                    </button>
                  </>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
