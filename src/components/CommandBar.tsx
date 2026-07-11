"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { parseTaskInput } from "@/lib/tasks";
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
} from "lucide-react";

type Cmd = {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  keywords: string;
  run: () => void;
};

export default function CommandBar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [sel, setSel] = useState(0);
  const [results, setResults] = useState<Cmd[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setValue("");
      setSel(0);
      setResults([]);
      setTimeout(() => inputRef.current?.focus(), 20);
    }
  }, [open]);

  const go = (path: string) => {
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

  const createTask = async (raw: string) => {
    const t = raw.trim();
    if (!t) return;
    const p = parseTaskInput(t);
    const supabase = createClient();
    await supabase.from("tasks").insert({ title: p.title, due_date: p.due_date, priority: p.priority });
    dispatch("cadence:tasks-changed");
    onClose();
  };

  const commands = useMemo<Cmd[]>(
    () => [
      { id: "nav-planner", label: "Go to Planner", icon: CalendarDays, keywords: "planner calendar home", run: () => go("/app") },
      { id: "nav-agenda", label: "Go to Agenda", icon: CalendarRange, keywords: "agenda list upcoming", run: () => go("/app/agenda") },
      { id: "nav-notes", label: "Go to Notes", icon: StickyNote, keywords: "notes", run: () => go("/app/notes") },
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

  // Global search across tasks + notes (debounced)
  useEffect(() => {
    const q = value.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    const h = setTimeout(async () => {
      const supabase = createClient();
      const [tasksR, notesR] = await Promise.all([
        supabase.from("tasks").select("id, title").ilike("title", `%${q}%`).limit(5),
        supabase.from("notes").select("id, title, body").or(`title.ilike.%${q}%,body.ilike.%${q}%`).limit(5),
      ]);
      const r: Cmd[] = [];
      ((tasksR.data as { id: string; title: string | null }[] | null) ?? []).forEach((t) =>
        r.push({ id: "task-" + t.id, label: "Task · " + (t.title || "Untitled"), icon: ListTodo, keywords: "", run: () => go("/app") })
      );
      ((notesR.data as { id: string; title: string | null }[] | null) ?? []).forEach((n) =>
        r.push({ id: "note-" + n.id, label: "Note · " + (n.title || "Untitled"), icon: StickyNote, keywords: "", run: () => go("/app/notes?note=" + n.id) })
      );
      setResults(r);
    }, 200);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const q = value.trim().toLowerCase();
  const filtered = q ? commands.filter((c) => (c.label + " " + c.keywords).toLowerCase().includes(q)) : commands;

  const createCmd: Cmd | null =
    q.length > 0
      ? { id: "create-task", label: `Create task: “${value.trim()}”`, icon: ListTodo, keywords: "", run: () => createTask(value) }
      : null;

  const items: Cmd[] = [...filtered, ...results, ...(createCmd ? [createCmd] : [])];

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
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-[14vh]" onClick={onClose}>
      <div
        className="w-full max-w-xl overflow-hidden rounded-2xl border border-border bg-surface2 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-border px-4">
          <Search className="h-4 w-4 text-txt3" />
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Search or type a command…"
            className="w-full bg-transparent py-4 text-txt outline-none placeholder:text-txt3"
          />
        </div>
        <div className="max-h-80 overflow-y-auto p-1">
          {items.map((c, i) => {
            const Icon = c.icon;
            return (
              <button
                key={c.id}
                onMouseEnter={() => setSel(i)}
                onClick={() => c.run()}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm ${
                  i === sel ? "bg-surface3 text-txt" : "text-txt2 hover:bg-surface"
                }`}
              >
                <Icon className="h-4 w-4 shrink-0 text-txt3" />
                <span className="flex-1 truncate">{c.label}</span>
                {c.id === "create-task" && <Plus className="h-3.5 w-3.5 text-txt3" />}
              </button>
            );
          })}
          {items.length === 0 && <p className="px-3 py-6 text-center text-sm text-txt3">No matches</p>}
        </div>
        <div className="border-t border-border px-4 py-2 text-xs text-txt3">
          ↑↓ navigate · Enter to run · Esc to close
        </div>
      </div>
    </div>
  );
}
