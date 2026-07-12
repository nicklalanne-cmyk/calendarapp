"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { parseTaskInput } from "@/lib/tasks";
import { getRecents, recordRecent, type RecentItem } from "@/lib/recent";
import {
  Search,
  CalendarDays,
  StickyNote,
  Link2,
  Plus,
  CalendarPlus,
  Sun,
  Columns3,
  Grid3x3,
  ListTodo,
  CalendarRange,
  Table2,
  Star,
  History,
  X,
  BookOpen,
} from "lucide-react";

type Cmd = {
  id: string;
  label: string;
  sublabel?: string;
  icon: React.ComponentType<{ className?: string }>;
  keywords: string;
  section?: "pinned" | "recent";
  run: () => void;
};

type PinnedPage = { id: string; title: string; icon: string | null; pinned_at: string | null };
type PinnedNote = { id: string; title: string; pinned_at: string | null };

// This is the one thing that's reachable from every screen on a phone — the
// search icon in the mobile header opens it, same as ⌘K does on desktop. On
// mobile it takes over the full screen (a floating box over a tiny keyboard-
// squeezed viewport is a bad time); on desktop it's the familiar centered
// palette. With nothing typed yet it leads with what you pinned, then what
// you opened recently, so "where's the recipe page" is a single tap — no
// typing required if you pinned it, and one search if you didn't.
export default function CommandBar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [sel, setSel] = useState(0);
  const [results, setResults] = useState<Cmd[]>([]);
  const [pinned, setPinned] = useState<Cmd[]>([]);
  const [recents, setRecents] = useState<Cmd[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const go = (path: string, recent?: Omit<RecentItem, "at">) => {
    if (recent) recordRecent(recent);
    router.push(path);
    onClose();
  };
  const plannerAction = (fn: () => void) => {
    router.push("/app");
    setTimeout(fn, 60);
    onClose();
  };
  const dispatch = (name: string, detail?: unknown) =>
    window.dispatchEvent(new CustomEvent(name, { detail }));

  useEffect(() => {
    if (!open) return;
    setValue("");
    setSel(0);
    setResults([]);
    setTimeout(() => inputRef.current?.focus(), 20);

    setRecents(
      getRecents().map((r) => ({
        id: `recent-${r.kind}-${r.id}`,
        label: r.label,
        icon: r.kind === "note" ? StickyNote : r.kind === "page" ? Table2 : r.kind === "notebook" ? BookOpen : ListTodo,
        keywords: "",
        section: "recent",
        run: () => go(r.href),
      }))
    );

    const supabase = createClient();
    (async () => {
      const [pagesR, notesR] = await Promise.all([
        supabase
          .from("pages")
          .select("id, title, icon, pinned_at")
          .is("deleted_at", null)
          .not("pinned_at", "is", null)
          .order("pinned_at", { ascending: false }),
        supabase
          .from("notes")
          .select("id, title, pinned_at")
          .is("deleted_at", null)
          .not("pinned_at", "is", null)
          .order("pinned_at", { ascending: false }),
      ]);
      const p: Cmd[] = ((pagesR.data as PinnedPage[] | null) ?? []).map((pg) => ({
        id: `pinned-page-${pg.id}`,
        label: `${pg.icon ?? "📄"} ${pg.title}`,
        icon: Star,
        keywords: "",
        section: "pinned",
        run: () => go(`/app/pages/${pg.id}`, { kind: "page", id: pg.id, label: pg.title, href: `/app/pages/${pg.id}` }),
      }));
      const n: Cmd[] = ((notesR.data as PinnedNote[] | null) ?? []).map((nt) => ({
        id: `pinned-note-${nt.id}`,
        label: nt.title || "Untitled note",
        icon: Star,
        keywords: "",
        section: "pinned",
        run: () =>
          go(`/app/notes?note=${nt.id}`, {
            kind: "note",
            id: nt.id,
            label: nt.title || "Untitled note",
            href: `/app/notes?note=${nt.id}`,
          }),
      }));
      setPinned([...p, ...n]);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const commands = useMemo<Cmd[]>(
    () => [
      { id: "nav-planner", label: "Go to Planner", icon: CalendarDays, keywords: "planner calendar home", run: () => go("/app") },
      { id: "nav-agenda", label: "Go to Agenda", icon: CalendarRange, keywords: "agenda list upcoming", run: () => go("/app/agenda") },
      { id: "nav-notes", label: "Go to Notes", icon: StickyNote, keywords: "notes", run: () => go("/app/notes") },
      { id: "nav-pages", label: "Go to Pages", icon: Table2, keywords: "pages database records", run: () => go("/app/pages") },
      { id: "nav-notebooks", label: "Go to Notebooks", icon: BookOpen, keywords: "notebooks goodnotes pdf annotate draw", run: () => go("/app/notebooks") },
      { id: "nav-cal", label: "Go to Calendars", icon: Link2, keywords: "calendars accounts connect google", run: () => go("/app/accounts") },
      { id: "today", label: "Jump to today", icon: Sun, keywords: "today now", run: () => plannerAction(() => dispatch("cadence:go-today")) },
      { id: "view-day", label: "Day view", icon: CalendarDays, keywords: "day view", run: () => plannerAction(() => dispatch("cadence:set-view", "day")) },
      { id: "view-week", label: "Week view", icon: Columns3, keywords: "week view", run: () => plannerAction(() => dispatch("cadence:set-view", "week")) },
      { id: "view-month", label: "Month view", icon: Grid3x3, keywords: "month view", run: () => plannerAction(() => dispatch("cadence:set-view", "month")) },
      { id: "new-event", label: "New event", icon: CalendarPlus, keywords: "new event create calendar block", run: () => plannerAction(() => dispatch("cadence:new-event")) },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const createTask = async (raw: string) => {
    const t = raw.trim();
    if (!t) return;
    const p = parseTaskInput(t);
    const supabase = createClient();
    await supabase.from("tasks").insert({ title: p.title, due_date: p.due_date, priority: p.priority });
    dispatch("cadence:tasks-changed");
    onClose();
  };

  // Global search across tasks, notes, pages, and page records (debounced).
  // Records are matched client-side against title + prop values since they're
  // free-form jsonb — fine at personal-app scale, and it means a search for
  // an ingredient or a name buried in a custom column still finds the row.
  useEffect(() => {
    const q = value.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    const h = setTimeout(async () => {
      const supabase = createClient();
      const [tasksR, notesR, pagesR, recordsR, notebooksR] = await Promise.all([
        supabase.from("tasks").select("id, title").ilike("title", `%${q}%`).is("deleted_at", null).limit(6),
        supabase
          .from("notes")
          .select("id, title, body")
          .is("deleted_at", null)
          .or(`title.ilike.%${q}%,body.ilike.%${q}%`)
          .limit(6),
        supabase.from("pages").select("id, title, icon").is("deleted_at", null).ilike("title", `%${q}%`).limit(6),
        supabase
          .from("page_records")
          .select("id, title, props, page_id, pages(title, icon)")
          .is("deleted_at", null)
          .limit(400),
        supabase
          .from("notebooks")
          .select("id, title")
          .is("deleted_at", null)
          .ilike("title", `%${q}%`)
          .limit(6),
      ]);

      const r: Cmd[] = [];
      ((tasksR.data as { id: string; title: string | null }[] | null) ?? []).forEach((t) =>
        r.push({
          id: "task-" + t.id,
          label: "Task · " + (t.title || "Untitled"),
          icon: ListTodo,
          keywords: "",
          run: () => go("/app"),
        })
      );
      ((notesR.data as { id: string; title: string | null }[] | null) ?? []).forEach((n) =>
        r.push({
          id: "note-" + n.id,
          label: "Note · " + (n.title || "Untitled"),
          icon: StickyNote,
          keywords: "",
          run: () =>
            go("/app/notes?note=" + n.id, {
              kind: "note",
              id: n.id,
              label: n.title || "Untitled",
              href: "/app/notes?note=" + n.id,
            }),
        })
      );
      ((pagesR.data as { id: string; title: string; icon: string | null }[] | null) ?? []).forEach((pg) =>
        r.push({
          id: "page-" + pg.id,
          label: (pg.icon ?? "📄") + " Page · " + pg.title,
          icon: Table2,
          keywords: "",
          run: () =>
            go("/app/pages/" + pg.id, { kind: "page", id: pg.id, label: pg.title, href: "/app/pages/" + pg.id }),
        })
      );

      ((notebooksR.data as { id: string; title: string }[] | null) ?? []).forEach((nb) =>
        r.push({
          id: "notebook-" + nb.id,
          label: "Notebook · " + (nb.title || "Untitled"),
          icon: BookOpen,
          keywords: "",
          run: () =>
            go("/app/notebooks/" + nb.id, {
              kind: "notebook",
              id: nb.id,
              label: nb.title || "Untitled",
              href: "/app/notebooks/" + nb.id,
            }),
        })
      );

      const needle = q.toLowerCase();
      type RecordRow = {
        id: string;
        title: string | null;
        props: Record<string, unknown>;
        page_id: string;
        pages: { title: string; icon: string | null } | { title: string; icon: string | null }[] | null;
      };
      ((recordsR.data as RecordRow[] | null) ?? [])
        .filter((rec) => {
          const haystack = (rec.title ?? "") + " " + JSON.stringify(rec.props ?? {});
          return haystack.toLowerCase().includes(needle);
        })
        .slice(0, 8)
        .forEach((rec) => {
          const page = Array.isArray(rec.pages) ? rec.pages[0] : rec.pages;
          r.push({
            id: "record-" + rec.id,
            label: (page?.icon ?? "📄") + " " + (page?.title ?? "Page") + " · " + (rec.title || "Untitled"),
            icon: Table2,
            keywords: "",
            run: () =>
              go("/app/pages/" + rec.page_id, {
                kind: "page",
                id: rec.page_id,
                label: page?.title ?? "Page",
                href: "/app/pages/" + rec.page_id,
              }),
          });
        });

      setResults(r);
    }, 200);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const q = value.trim().toLowerCase();
  const filtered = q ? commands.filter((c) => (c.label + " " + c.keywords).toLowerCase().includes(q)) : [];

  const createCmd: Cmd | null =
    q.length > 0
      ? { id: "create-task", label: `Create task: "${value.trim()}"`, icon: Plus, keywords: "", run: () => createTask(value) }
      : null;

  const items: Cmd[] = q
    ? [...results, ...filtered, ...(createCmd ? [createCmd] : [])]
    : [...pinned, ...recents];

  useEffect(() => {
    setSel(0);
  }, [value, results.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!open) return;
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowDown") {
        e.preventDefault();
        setSel((s) => Math.min(s + 1, items.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSel((s) => Math.max(s - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        items[sel]?.run();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, items, sel, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-surface2 md:items-start md:justify-center md:bg-black/50 md:pt-[14vh]"
      style={{ height: "var(--app-height, 100dvh)" }}
      onClick={onClose}
    >
      <div
        className="flex h-full w-full flex-col md:h-auto md:max-w-xl md:overflow-hidden md:rounded-2xl md:border md:border-border md:bg-surface2 md:shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex shrink-0 items-center gap-3 border-b border-border px-4"
          style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}
        >
          <Search className="h-4 w-4 shrink-0 text-txt3" />
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Search notes, pages, tasks…"
            className="w-full bg-transparent py-3.5 text-[17px] text-txt outline-none placeholder:text-txt3 md:py-4 md:text-base"
            enterKeyHint="search"
          />
          <button
            onClick={onClose}
            aria-label="Close search"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-txt3 active:bg-surface3 md:hidden"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-1.5 md:max-h-80">
          {!q && pinned.length > 0 && <SectionLabel icon={<Star className="h-3 w-3" />} label="Pinned" />}
          {!q && !pinned.length && !recents.length && (
            <p className="px-3 py-8 text-center text-sm text-txt3">
              Start typing, or pin a page/note (⋯ menu) to see it here every time.
            </p>
          )}
          {items.map((c, i) => {
            const Icon = c.icon;
            const showRecentLabel = c.section === "recent" && (i === 0 || items[i - 1]?.section !== "recent");
            return (
              <div key={c.id}>
                {showRecentLabel && <SectionLabel icon={<History className="h-3 w-3" />} label="Recent" />}
                <button
                  onMouseEnter={() => setSel(i)}
                  onClick={() => c.run()}
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left text-[15px] md:py-2.5 md:text-sm ${
                    i === sel ? "bg-surface3 text-txt" : "text-txt2 active:bg-surface3 md:hover:bg-surface"
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0 text-txt3" />
                  <span className="flex-1 truncate">{c.label}</span>
                  {c.id === "create-task" && <Plus className="h-3.5 w-3.5 shrink-0 text-txt3" />}
                </button>
              </div>
            );
          })}
          {q && items.length === 0 && <p className="px-3 py-8 text-center text-sm text-txt3">No matches</p>}
        </div>

        <div className="hidden shrink-0 border-t border-border px-4 py-2 text-xs text-txt3 md:block">
          ↑↓ navigate · Enter to run · Esc to close
        </div>
      </div>
    </div>
  );
}

function SectionLabel({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-1.5 px-3 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-txt3">
      {icon}
      {label}
    </div>
  );
}
