"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Loader2, X, Star, Users, Trash2, BookOpen } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/lib/toast";
import { recordRecent } from "@/lib/recent";
import { NOTEBOOK_COLORS } from "@/lib/notebooks";
import type { Notebook } from "@/lib/types";

export default function NotebooksView() {
  const supabase = createClient();
  const router = useRouter();
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [loading, setLoading] = useState(true);
  const [picking, setPicking] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newColor, setNewColor] = useState(NOTEBOOK_COLORS[0]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: u }) => setCurrentUserId(u.user?.id ?? null));
  }, [supabase]);

  const pinned = notebooks.filter((n) => n.pinned_at);
  const rest = notebooks.filter((n) => !n.pinned_at);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("notebooks")
      .select("*")
      .is("deleted_at", null)
      .order("created_at", { ascending: false });
    setNotebooks((data as Notebook[]) ?? []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  const open = (n: Notebook) => {
    recordRecent({ kind: "page", id: n.id, label: n.title, href: `/app/notebooks/${n.id}` });
    router.push(`/app/notebooks/${n.id}`);
  };

  const create = async () => {
    setCreating(true);
    const { data, error } = await supabase
      .from("notebooks")
      .insert({ title: newTitle.trim() || "Untitled notebook", color: newColor })
      .select()
      .single();
    if (error || !data) {
      setCreating(false);
      return toast(error?.message ?? "Couldn't create the notebook", "error");
    }

    // seed one blank page so it opens ready to write on
    await supabase.from("notebook_pages").insert({
      notebook_id: data.id,
      position: 0,
      template: "blank",
    });

    setCreating(false);
    setPicking(false);
    setNewTitle("");
    router.push(`/app/notebooks/${data.id}`);
  };

  const togglePin = async (n: Notebook, e: React.MouseEvent) => {
    e.stopPropagation();
    const pinning = !n.pinned_at;
    setNotebooks((prev) =>
      prev.map((x) => (x.id === n.id ? { ...x, pinned_at: pinning ? new Date().toISOString() : null } : x))
    );
    const { error } = await supabase
      .from("notebooks")
      .update({ pinned_at: pinning ? new Date().toISOString() : null })
      .eq("id", n.id);
    if (error) {
      toast(error.message, "error");
      load();
    }
  };

  const toggleShare = async (n: Notebook, e: React.MouseEvent) => {
    e.stopPropagation();
    const sharing = !n.shared;
    setNotebooks((prev) => prev.map((x) => (x.id === n.id ? { ...x, shared: sharing } : x)));
    const { error } = await supabase.from("notebooks").update({ shared: sharing }).eq("id", n.id);
    if (error) {
      toast(error.message, "error");
      load();
    } else {
      toast(sharing ? `Shared "${n.title}" with your partner` : `Unshared "${n.title}"`);
    }
  };

  const remove = async (n: Notebook, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm(`Delete "${n.title}"? This can't be undone.`)) return;
    setNotebooks((prev) => prev.filter((x) => x.id !== n.id));
    const { error } = await supabase
      .from("notebooks")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", n.id);
    if (error) {
      toast(error.message, "error");
      load();
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl px-4 py-6 md:px-8">
        <div className="mb-5 flex items-center gap-3">
          <h1 className="text-2xl font-semibold">Notebooks</h1>
          <button
            onClick={() => setPicking(true)}
            className="ml-auto flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white active:opacity-80"
          >
            <Plus className="h-4 w-4" /> New notebook
          </button>
        </div>

        {loading ? (
          <Loader2 className="h-5 w-5 animate-spin text-txt3" />
        ) : notebooks.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-8 text-center">
            <BookOpen className="mx-auto h-8 w-8 text-txt3" />
            <p className="mt-2 text-sm text-txt2">No notebooks yet.</p>
            <p className="mt-1 text-xs text-txt3">
              Write freehand on lined, grid, or dotted pages — or import a PDF and mark it up.
            </p>
            <button
              onClick={() => setPicking(true)}
              className="mt-4 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white"
            >
              Create one
            </button>
          </div>
        ) : (
          <>
            {pinned.length > 0 && (
              <div className="mb-6">
                <h2 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-txt3">
                  <Star className="h-3 w-3" /> Pinned
                </h2>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                  {pinned.map((n) => (
                    <NotebookCard
                      key={n.id}
                      notebook={n}
                      isOwner={n.user_id === currentUserId}
                      onOpen={() => open(n)}
                      onTogglePin={(e) => togglePin(n, e)}
                      onToggleShare={(e) => toggleShare(n, e)}
                      onDelete={(e) => remove(n, e)}
                    />
                  ))}
                </div>
              </div>
            )}
            <div>
              {pinned.length > 0 && (
                <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-txt3">All notebooks</h2>
              )}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                {rest.map((n) => (
                  <NotebookCard
                    key={n.id}
                    notebook={n}
                    isOwner={n.user_id === currentUserId}
                    onOpen={() => open(n)}
                    onTogglePin={(e) => togglePin(n, e)}
                    onToggleShare={(e) => toggleShare(n, e)}
                    onDelete={(e) => remove(n, e)}
                  />
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      {picking && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center md:justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setPicking(false)} />
          <div className="relative w-full rounded-t-2xl border-t border-border bg-surface p-4 pb-8 md:max-w-sm md:rounded-2xl md:border md:pb-4">
            <div className="mb-3 flex items-center">
              <h2 className="text-base font-semibold">New notebook</h2>
              <button
                onClick={() => setPicking(false)}
                className="ml-auto flex h-9 w-9 items-center justify-center rounded-lg text-txt3 active:bg-surface2"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <input
              autoFocus
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && create()}
              placeholder="Notebook title"
              className="w-full rounded-lg border border-border bg-bg px-3 py-2.5 text-sm outline-none focus:border-accent"
            />

            <div className="mt-3 flex items-center gap-2">
              {NOTEBOOK_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => setNewColor(c)}
                  className="h-7 w-7 rounded-full border-2 transition"
                  style={{ background: c, borderColor: c === newColor ? "var(--txt)" : "transparent" }}
                />
              ))}
            </div>

            <button
              disabled={creating}
              onClick={create}
              className="mt-4 w-full rounded-lg bg-accent py-2.5 text-sm font-medium text-white disabled:opacity-50"
            >
              {creating ? "Creating…" : "Create notebook"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function NotebookCard({
  notebook,
  isOwner,
  onOpen,
  onTogglePin,
  onToggleShare,
  onDelete,
}: {
  notebook: Notebook;
  isOwner: boolean;
  onOpen: () => void;
  onTogglePin: (e: React.MouseEvent) => void;
  onToggleShare: (e: React.MouseEvent) => void;
  onDelete: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      onClick={onOpen}
      className="group relative flex aspect-[3/4] flex-col justify-end overflow-hidden rounded-xl border border-border p-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
      style={{ background: `linear-gradient(160deg, ${notebook.color}, ${notebook.color}CC)` }}
    >
      <BookOpen className="absolute right-3 top-3 h-6 w-6 text-white/25" />
      {!isOwner && notebook.shared && (
        <span title="Shared with you" className="absolute left-3 top-3 text-white/80">
          <Users className="h-4 w-4" />
        </span>
      )}
      <span className="truncate text-sm font-semibold text-white drop-shadow-sm">{notebook.title}</span>

      <span
        onClick={onTogglePin}
        role="button"
        aria-label={notebook.pinned_at ? "Unpin" : "Pin"}
        className={`absolute right-1.5 top-1.5 flex h-8 w-8 items-center justify-center rounded-lg text-white transition-opacity active:bg-white/20 md:opacity-0 md:group-hover:opacity-100 ${
          notebook.pinned_at ? "opacity-100" : ""
        }`}
      >
        <Star className="h-3.5 w-3.5" fill={notebook.pinned_at ? "currentColor" : "none"} />
      </span>
      {isOwner && (
        <span
          onClick={onDelete}
          role="button"
          aria-label="Delete notebook"
          className="absolute bottom-1.5 right-1.5 flex h-8 w-8 items-center justify-center rounded-lg text-white/80 transition-opacity hover:text-white active:bg-white/20 md:opacity-0 md:group-hover:opacity-100"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </span>
      )}
      {isOwner && (
        <span
          onClick={onToggleShare}
          role="button"
          aria-label={notebook.shared ? "Unshare" : "Share with partner"}
          className={`absolute bottom-1.5 left-1.5 flex h-8 w-8 items-center justify-center rounded-lg text-white/80 transition-opacity hover:text-white active:bg-white/20 md:opacity-0 md:group-hover:opacity-100 ${
            notebook.shared ? "opacity-100" : ""
          }`}
        >
          <Users className="h-3.5 w-3.5" fill={notebook.shared ? "currentColor" : "none"} />
        </span>
      )}
    </button>
  );
}
