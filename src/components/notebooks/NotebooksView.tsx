"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Plus, Loader2, X, Star, Users, Trash2, BookOpen, FolderPlus, Folder,
  FolderOpen, MoveRight,
} from "lucide-react";
import clsx from "clsx";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/lib/toast";
import { recordRecent } from "@/lib/recent";
import { NOTEBOOK_COLORS, TEMPLATE_LABELS } from "@/lib/notebooks";
import type { Notebook, NotebookFolder, NotebookPageTemplate } from "@/lib/types";

type PageStyleChoice = NotebookPageTemplate;

export default function NotebooksView() {
  const supabase = createClient();
  const router = useRouter();
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [folders, setFolders] = useState<NotebookFolder[]>([]);
  const [folderFilter, setFolderFilter] = useState<string | null | "all">("all");
  const [loading, setLoading] = useState(true);
  const [picking, setPicking] = useState(false);
  const [step, setStep] = useState<"details" | "style">("details");
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newColor, setNewColor] = useState(NOTEBOOK_COLORS[0]);
  const [newFolder, setNewFolder] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [addingFolder, setAddingFolder] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [moveMenuFor, setMoveMenuFor] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    supabase.auth.getUser().then(({ data: u }) => setCurrentUserId(u.user?.id ?? null));
  }, [supabase]);

  const searching = searchQuery.trim().length > 0;
  // A title search naturally wants to look across every folder at once, not
  // just whichever one happens to be selected — so it bypasses the folder
  // filter entirely rather than requiring "All" to be picked first.
  const visible = searching
    ? notebooks.filter((n) => n.title.toLowerCase().includes(searchQuery.trim().toLowerCase()))
    : folderFilter === "all"
      ? notebooks
      : notebooks.filter((n) => (folderFilter === null ? !n.folder_id : n.folder_id === folderFilter));
  const pinned = visible.filter((n) => n.pinned_at);
  const rest = visible.filter((n) => !n.pinned_at);

  const load = useCallback(async () => {
    const [{ data }, { data: fData }] = await Promise.all([
      supabase.from("notebooks").select("*").is("deleted_at", null).order("created_at", { ascending: false }),
      supabase.from("notebook_folders").select("*").order("position"),
    ]);
    setNotebooks((data as Notebook[]) ?? []);
    setFolders((fData as NotebookFolder[]) ?? []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  const open = (n: Notebook) => {
    recordRecent({ kind: "notebook", id: n.id, label: n.title, href: `/app/notebooks/${n.id}` });
    router.push(`/app/notebooks/${n.id}`);
  };

  const openPicker = () => {
    setNewTitle("");
    setNewColor(NOTEBOOK_COLORS[0]);
    setNewFolder(folderFilter === "all" ? null : folderFilter);
    setStep("details");
    setPicking(true);
  };

  const create = async (style: PageStyleChoice) => {
    setCreating(true);
    const { data, error } = await supabase
      .from("notebooks")
      .insert({ title: newTitle.trim() || "Untitled notebook", color: newColor, folder_id: newFolder })
      .select()
      .single();
    if (error || !data) {
      setCreating(false);
      return toast(error?.message ?? "Couldn't create the notebook", "error");
    }

    setCreating(false);
    setPicking(false);
    setNewTitle("");

    if (style === "pdf") {
      // PDF pages are created by the editor once a file is picked — send it
      // straight there with a flag that opens the file picker on arrival.
      router.push(`/app/notebooks/${data.id}?import=1`);
      return;
    }

    await supabase.from("notebook_pages").insert({ notebook_id: data.id, position: 0, template: style });
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
    setNotebooks((prev) => prev.filter((x) => x.id !== n.id));
    const { error } = await supabase
      .from("notebooks")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", n.id);
    if (error) {
      toast(error.message, "error");
      load();
      return;
    }
    toast(`Deleted "${n.title}"`, {
      action: {
        label: "Undo",
        run: async () => {
          const { error: undoErr } = await supabase
            .from("notebooks")
            .update({ deleted_at: null })
            .eq("id", n.id);
          if (undoErr) return toast(undoErr.message, "error");
          load();
        },
      },
    });
  };

  const moveToFolder = async (n: Notebook, folderId: string | null, e: React.MouseEvent) => {
    e.stopPropagation();
    setMoveMenuFor(null);
    setNotebooks((prev) => prev.map((x) => (x.id === n.id ? { ...x, folder_id: folderId } : x)));
    const { error } = await supabase.from("notebooks").update({ folder_id: folderId }).eq("id", n.id);
    if (error) {
      toast(error.message, "error");
      load();
    }
  };

  const createFolder = async () => {
    const name = folderName.trim();
    if (!name) return setAddingFolder(false);
    const color = NOTEBOOK_COLORS[folders.length % NOTEBOOK_COLORS.length];
    const { data, error } = await supabase
      .from("notebook_folders")
      .insert({ name, color, position: folders.length })
      .select()
      .single();
    if (error || !data) return toast(error?.message ?? "Couldn't create the folder", "error");
    setFolders((prev) => [...prev, data as NotebookFolder]);
    setFolderName("");
    setAddingFolder(false);
  };

  // notebook_folders has no deleted_at column, so — same as automations —
  // hold the real delete for a few seconds behind a cancellable timer instead
  // of either blocking on window.confirm() or deleting with no way back.
  const deleteFolder = (f: NotebookFolder) => {
    const idx = folders.findIndex((x) => x.id === f.id);
    setFolders((prev) => prev.filter((x) => x.id !== f.id));
    if (folderFilter === f.id) setFolderFilter("all");
    let cancelled = false;
    const timer = setTimeout(async () => {
      if (cancelled) return;
      const { error } = await supabase.from("notebook_folders").delete().eq("id", f.id);
      if (error) {
        toast(error.message, "error");
        load();
      }
    }, 6000);
    toast(`Deleted folder "${f.name}"`, {
      action: {
        label: "Undo",
        run: () => {
          cancelled = true;
          clearTimeout(timer);
          setFolders((prev) => {
            const next = [...prev];
            next.splice(Math.min(idx, next.length), 0, f);
            return next;
          });
        },
      },
    });
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl px-4 py-6 md:px-8">
        <div className="mb-4 flex items-center gap-3">
          <h1 className="text-2xl font-semibold">Notebooks</h1>
          <button
            onClick={openPicker}
            className="ml-auto flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white active:opacity-80"
          >
            <Plus className="h-4 w-4" /> New notebook
          </button>
        </div>

        <input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search notebooks…"
          className="mb-3 w-full max-w-sm rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
        />

        <div className={clsx("mb-5 flex flex-wrap items-center gap-1.5", searching && "opacity-40")}>
          <FolderChip
            active={folderFilter === "all"}
            onClick={() => setFolderFilter("all")}
            icon={<BookOpen className="h-3.5 w-3.5" />}
            label="All"
          />
          <FolderChip
            active={folderFilter === null}
            onClick={() => setFolderFilter(null)}
            icon={<Folder className="h-3.5 w-3.5" />}
            label="Unfiled"
          />
          {folders.map((f) => (
            <FolderChip
              key={f.id}
              active={folderFilter === f.id}
              onClick={() => setFolderFilter(f.id)}
              icon={<Folder className="h-3.5 w-3.5" style={{ color: f.color }} />}
              label={f.name}
              onDelete={() => deleteFolder(f)}
            />
          ))}
          {addingFolder ? (
            <input
              autoFocus
              value={folderName}
              onChange={(e) => setFolderName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && createFolder()}
              onBlur={createFolder}
              placeholder="Folder name…"
              className="h-7 w-28 rounded-full border border-border bg-bg px-3 text-xs outline-none focus:border-accent"
            />
          ) : (
            <button
              onClick={() => setAddingFolder(true)}
              className="flex h-7 items-center gap-1 rounded-full border border-dashed border-border px-2.5 text-xs text-txt3 hover:border-accent/60 hover:text-txt2"
            >
              <FolderPlus className="h-3.5 w-3.5" /> Folder
            </button>
          )}
        </div>

        {loading ? (
          <Loader2 className="h-5 w-5 animate-spin text-txt3" />
        ) : visible.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-8 text-center">
            <BookOpen className="mx-auto h-8 w-8 text-txt3" />
            <p className="mt-2 text-sm text-txt2">No notebooks here yet.</p>
            <p className="mt-1 text-xs text-txt3">
              Write freehand on lined, grid, or dotted pages — or import a PDF and mark it up.
            </p>
            <button
              onClick={openPicker}
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
                      folders={folders}
                      onOpen={() => open(n)}
                      onTogglePin={(e) => togglePin(n, e)}
                      onToggleShare={(e) => toggleShare(n, e)}
                      onDelete={(e) => remove(n, e)}
                      moveMenuOpen={moveMenuFor === n.id}
                      onToggleMoveMenu={(e) => {
                        e.stopPropagation();
                        setMoveMenuFor((cur) => (cur === n.id ? null : n.id));
                      }}
                      onMove={(fid, e) => moveToFolder(n, fid, e)}
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
                    folders={folders}
                    onOpen={() => open(n)}
                    onTogglePin={(e) => togglePin(n, e)}
                    onToggleShare={(e) => toggleShare(n, e)}
                    onDelete={(e) => remove(n, e)}
                    moveMenuOpen={moveMenuFor === n.id}
                    onToggleMoveMenu={(e) => {
                      e.stopPropagation();
                      setMoveMenuFor((cur) => (cur === n.id ? null : n.id));
                    }}
                    onMove={(fid, e) => moveToFolder(n, fid, e)}
                  />
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      {picking && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center md:justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => !creating && setPicking(false)} />
          <div className="relative w-full rounded-t-2xl border-t border-border bg-surface p-4 pb-8 md:max-w-sm md:rounded-2xl md:border md:pb-4">
            {step === "details" ? (
              <>
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
                  onKeyDown={(e) => e.key === "Enter" && setStep("style")}
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

                {folders.length > 0 && (
                  <div className="mt-3">
                    <label className="mb-1 block text-xs text-txt3">Folder</label>
                    <select
                      value={newFolder ?? ""}
                      onChange={(e) => setNewFolder(e.target.value || null)}
                      className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
                    >
                      <option value="">Unfiled</option>
                      {folders.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <button
                  onClick={() => setStep("style")}
                  className="mt-4 w-full rounded-lg bg-accent py-2.5 text-sm font-medium text-white"
                >
                  Next: choose a page style
                </button>
              </>
            ) : (
              <>
                <div className="mb-3 flex items-center">
                  <button
                    onClick={() => setStep("details")}
                    className="mr-1 flex h-9 w-9 items-center justify-center rounded-lg text-txt3 active:bg-surface2"
                  >
                    <MoveRight className="h-4 w-4 rotate-180" />
                  </button>
                  <h2 className="text-base font-semibold">Choose a page style</h2>
                  <button
                    onClick={() => setPicking(false)}
                    className="ml-auto flex h-9 w-9 items-center justify-center rounded-lg text-txt3 active:bg-surface2"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  {(Object.keys(TEMPLATE_LABELS) as (keyof typeof TEMPLATE_LABELS)[]).map((t) => (
                    <button
                      key={t}
                      disabled={creating}
                      onClick={() => create(t)}
                      className="rounded-xl border border-border p-3 text-left text-sm font-medium hover:border-accent/60 hover:bg-surface2 disabled:opacity-50"
                    >
                      <PagePreview template={t} />
                      {TEMPLATE_LABELS[t]}
                    </button>
                  ))}
                </div>
                <button
                  disabled={creating}
                  onClick={() => create("pdf")}
                  className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border p-3 text-sm font-medium text-txt2 hover:border-accent/60 hover:bg-surface2 disabled:opacity-50"
                >
                  {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <FolderOpen className="h-4 w-4" />}
                  Import a PDF instead
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function PagePreview({ template }: { template: NotebookPageTemplate }) {
  return (
    <div className="mb-1.5 h-10 w-8 rounded border border-border bg-white bg-[length:8px_8px]"
      style={
        template === "lined"
          ? { backgroundImage: "linear-gradient(to bottom, transparent 7px, #E5E7EB 7px, #E5E7EB 8px)" }
          : template === "grid"
            ? {
                backgroundImage:
                  "linear-gradient(to bottom, #E5E7EB 1px, transparent 1px), linear-gradient(to right, #E5E7EB 1px, transparent 1px)",
              }
            : template === "dotted"
              ? { backgroundImage: "radial-gradient(#D1D5DB 1px, transparent 1px)", backgroundSize: "6px 6px" }
              : undefined
      }
    />
  );
}

function FolderChip({
  active,
  onClick,
  icon,
  label,
  onDelete,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  onDelete?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        "group flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition",
        active ? "border-accent bg-accent/10 text-accent" : "border-border text-txt2 hover:bg-surface2"
      )}
    >
      {icon}
      {label}
      {onDelete && (
        <span
          role="button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="ml-0.5 hidden rounded-full p-0.5 hover:bg-surface3 group-hover:block"
        >
          <X className="h-2.5 w-2.5" />
        </span>
      )}
    </button>
  );
}

function NotebookCard({
  notebook,
  isOwner,
  folders,
  onOpen,
  onTogglePin,
  onToggleShare,
  onDelete,
  moveMenuOpen,
  onToggleMoveMenu,
  onMove,
}: {
  notebook: Notebook;
  isOwner: boolean;
  folders: NotebookFolder[];
  onOpen: () => void;
  onTogglePin: (e: React.MouseEvent) => void;
  onToggleShare: (e: React.MouseEvent) => void;
  onDelete: (e: React.MouseEvent) => void;
  moveMenuOpen: boolean;
  onToggleMoveMenu: (e: React.MouseEvent) => void;
  onMove: (folderId: string | null, e: React.MouseEvent) => void;
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
      {isOwner && folders.length > 0 && (
        <span
          onClick={onToggleMoveMenu}
          role="button"
          aria-label="Move to folder"
          className="absolute bottom-1.5 left-10 flex h-8 w-8 items-center justify-center rounded-lg text-white/80 transition-opacity hover:text-white active:bg-white/20 md:opacity-0 md:group-hover:opacity-100"
        >
          <Folder className="h-3.5 w-3.5" />
        </span>
      )}
      {moveMenuOpen && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute bottom-10 left-2 z-10 w-36 rounded-lg border border-border bg-surface p-1 text-txt shadow-lg"
        >
          <button
            onClick={(e) => onMove(null, e)}
            className="block w-full rounded px-2 py-1.5 text-left text-xs hover:bg-surface2"
          >
            Unfiled
          </button>
          {folders.map((f) => (
            <button
              key={f.id}
              onClick={(e) => onMove(f.id, e)}
              className="block w-full rounded px-2 py-1.5 text-left text-xs hover:bg-surface2"
            >
              {f.name}
            </button>
          ))}
        </div>
      )}
    </button>
  );
}
