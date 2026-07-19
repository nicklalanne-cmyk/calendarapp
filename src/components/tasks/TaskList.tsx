"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import { Plus, Hash, SlidersHorizontal, ChevronDown, ChevronRight, CheckSquare, Square, X } from "lucide-react";
import type { Task } from "@/lib/types";
import TaskItem from "@/components/tasks/TaskItem";
import { parseTaskInput, startOfWeek, type ParsedTask } from "@/lib/tasks";
import { toISODate } from "@/lib/recurrence";

const byPriority = (a: Task, b: Task) =>
  (a.priority || 99) - (b.priority || 99) || (a.due_date ?? "").localeCompare(b.due_date ?? "");

export default function TaskList({
  tasks,
  onAdd,
  onToggle,
  onDelete,
  onCyclePriority,
  onAddSubtask,
  onEditSubtask,
  onOpenNote,
  onOpenTask,
  onNewTask,
  onSchedule,
  onBulkComplete,
  onBulkDelete,
  onBulkSetDueDate,
}: {
  tasks: Task[];
  onAdd: (parsed: ParsedTask) => void;
  onToggle: (t: Task) => void;
  onDelete: (t: Task) => void;
  onCyclePriority: (t: Task) => void;
  onAddSubtask: (parent: Task, title: string) => void;
  /** Renames a subtask in place — optional, same pattern as onAddSubtask. */
  onEditSubtask?: (subtask: Task, title: string) => void;
  onOpenNote: (t: Task) => void;
  onOpenTask: (t: Task) => void;
  onNewTask: () => void;
  onSchedule: (t: Task) => void;
  /** Bulk actions for multi-select — all optional so this still works as a
   * plain read-only list wherever a caller doesn't wire them up. */
  onBulkComplete?: (ids: string[]) => void;
  onBulkDelete?: (ids: string[]) => void;
  onBulkSetDueDate?: (ids: string[], dueDate: string) => void;
}) {
  const [value, setValue] = useState("");
  const [projectFilter, setProjectFilter] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDueDate, setBulkDueDate] = useState("");
  const todayStr = format(new Date(), "yyyy-MM-dd");

  const canBulk = Boolean(onBulkComplete || onBulkDelete || onBulkSetDueDate);
  const toggleSelected = (id: string) => {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const exitSelectMode = () => {
    setSelectMode(false);
    setSelected(new Set());
    setBulkDueDate("");
  };

  // Which section headers are collapsed, persisted across visits — mirrors
  // AppShell's "cadence-thoughts-open" localStorage pattern. "Completed" is
  // collapsed by default on first visit since it's usually just noise once
  // there's anything in it.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  useEffect(() => {
    try {
      const raw = localStorage.getItem("cadence-bucket-collapsed");
      setCollapsed(new Set(raw ? (JSON.parse(raw) as string[]) : ["Completed"]));
    } catch {
      setCollapsed(new Set(["Completed"]));
    }
  }, []);
  const toggleSection = (title: string) => {
    setCollapsed((cur) => {
      const next = new Set(cur);
      if (next.has(title)) next.delete(title);
      else next.add(title);
      try {
        localStorage.setItem("cadence-bucket-collapsed", JSON.stringify(Array.from(next)));
      } catch {}
      return next;
    });
  };

  const children = new Map<string, Task[]>();
  for (const t of tasks) {
    if (t.parent_id) {
      if (!children.has(t.parent_id)) children.set(t.parent_id, []);
      children.get(t.parent_id)!.push(t);
    }
  }

  const projects = Array.from(
    new Set(tasks.filter((t) => !t.parent_id && t.project).map((t) => t.project as string))
  ).sort();

  const searchQ = searchQuery.trim().toLowerCase();
  const top = tasks
    .filter((t) => !t.parent_id)
    .filter((t) => (projectFilter ? t.project === projectFilter : true))
    .filter((t) =>
      searchQ
        ? t.title.toLowerCase().includes(searchQ) ||
          (t.notes ?? "").toLowerCase().includes(searchQ) ||
          (t.tags ?? []).some((tag) => tag.toLowerCase().includes(searchQ))
        : true
    );

  const thisWeekStart = toISODate(startOfWeek(new Date()));

  const isWeek = (t: Task) => (t.due_kind ?? "day") === "week";
  const weekEnd = (t: Task) => {
    const d = new Date(`${t.due_date}T00:00:00`);
    d.setDate(d.getDate() + 6);
    return toISODate(d);
  };

  const open = top.filter((t) => !t.is_done);
  const dated = open.filter((t) => t.due_date);

  const overdue = dated
    .filter((t) => (isWeek(t) ? weekEnd(t) < todayStr : t.due_date! < todayStr))
    .sort(byPriority);
  const today = dated
    .filter((t) => !isWeek(t) && t.due_date === todayStr)
    .sort(byPriority);
  const thisWeek = dated
    .filter((t) => isWeek(t) && t.due_date === thisWeekStart && weekEnd(t) >= todayStr)
    .sort(byPriority);
  const upcoming = dated
    .filter(
      (t) =>
        !overdue.includes(t) && !today.includes(t) && !thisWeek.includes(t)
    )
    .sort((a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? ""));
  const inbox = open.filter((t) => !t.due_date).sort(byPriority);
  const done = top.filter((t) => t.is_done);

  const submit = () => {
    const v = value.trim();
    if (!v) return;
    onAdd(parseTaskInput(v));
    setValue("");
  };

  const Section = ({ title, items, danger }: { title: string; items: Task[]; danger?: boolean }) => {
    if (items.length === 0) return null;
    const isCollapsed = collapsed.has(title);
    return (
      <div className="mb-3">
        <button
          onClick={() => toggleSection(title)}
          className={`flex w-full items-center gap-1 px-1.5 pb-1 text-[11px] font-semibold uppercase tracking-wide ${
            danger ? "text-danger" : "text-txt3"
          }`}
        >
          {isCollapsed ? (
            <ChevronRight className="h-3 w-3 shrink-0" />
          ) : (
            <ChevronDown className="h-3 w-3 shrink-0" />
          )}
          {title} <span className="text-txt3">{items.length}</span>
        </button>
        {!isCollapsed &&
          items.map((t) =>
            selectMode ? (
              <div key={t.id} className="flex items-start gap-1.5">
                <button
                  onClick={() => toggleSelected(t.id)}
                  aria-label={selected.has(t.id) ? "Deselect" : "Select"}
                  className="mt-2.5 shrink-0 text-txt3 hover:text-accent"
                >
                  {selected.has(t.id) ? (
                    <CheckSquare className="h-4 w-4 text-accent" />
                  ) : (
                    <Square className="h-4 w-4" />
                  )}
                </button>
                <div className="min-w-0 flex-1">
                  <TaskItem
                    task={t}
                    subtasks={children.get(t.id) ?? []}
                    onToggle={onToggle}
                    onDelete={onDelete}
                    onCyclePriority={onCyclePriority}
                    onAddSubtask={onAddSubtask}
                    onEditSubtask={onEditSubtask}
                    onOpenNote={onOpenNote}
                    onOpenTask={() => toggleSelected(t.id)}
                    onSchedule={onSchedule}
                  />
                </div>
              </div>
            ) : (
              <TaskItem
                key={t.id}
                task={t}
                subtasks={children.get(t.id) ?? []}
                onToggle={onToggle}
                onDelete={onDelete}
                onCyclePriority={onCyclePriority}
                onAddSubtask={onAddSubtask}
                onEditSubtask={onEditSubtask}
                onOpenNote={onOpenNote}
                onOpenTask={onOpenTask}
                onSchedule={onSchedule}
              />
            )
          )}
      </div>
    );
  };

  const empty = open.length === 0 && done.length === 0;

  return (
    <div className="flex h-full flex-col">
      <div className="mb-2 flex items-center gap-1.5 rounded-lg border border-border bg-surface pl-2 pr-1">
        <Plus className="h-4 w-4 shrink-0 text-txt3" />
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="Add task — “#work ~45m every other thursday p1”"
          className="min-w-0 flex-1 bg-transparent py-3 text-[15px] outline-none placeholder:text-txt3 md:py-2 md:text-sm"
        />
        <button
          onClick={onNewTask}
          title="Add with all the details"
          className="shrink-0 rounded-lg p-2.5 text-txt3 transition active:bg-surface2 md:p-1.5 md:hover:bg-surface2 md:hover:text-txt"
        >
          <SlidersHorizontal className="h-[18px] w-[18px] md:h-3.5 md:w-3.5" />
        </button>
      </div>

      <input
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        placeholder="Search tasks…"
        className="mb-2 w-full rounded-lg border border-border bg-surface px-2.5 py-2 text-sm outline-none focus:border-accent md:py-1.5"
      />

      <div className="mb-2 flex flex-wrap items-center gap-1">
        {projects.map((p) => (
          <button
            key={p}
            onClick={() => setProjectFilter(projectFilter === p ? null : p)}
            className={`flex items-center gap-0.5 rounded-full px-3 py-1.5 text-xs md:px-2 md:py-0.5 md:text-[11px] ${
              projectFilter === p ? "bg-accent text-white" : "bg-surface text-txt3 hover:text-txt"
            }`}
          >
            <Hash className="h-2.5 w-2.5" />
            {p}
          </button>
        ))}
        {projects.length > 0 && (
          <button
            onClick={() => setProjectFilter(null)}
            className={`rounded-full px-3 py-1.5 text-xs md:px-2 md:py-0.5 md:text-[11px] ${
              projectFilter === null ? "bg-accent text-white" : "bg-surface text-txt3 hover:text-txt"
            }`}
          >
            All
          </button>
        )}
        {canBulk && (
          <button
            onClick={() => (selectMode ? exitSelectMode() : setSelectMode(true))}
            className={`ml-auto flex items-center gap-1 rounded-full px-3 py-1.5 text-xs md:px-2 md:py-0.5 md:text-[11px] ${
              selectMode ? "bg-accent text-white" : "bg-surface text-txt3 hover:text-txt"
            }`}
          >
            {selectMode ? <X className="h-3 w-3" /> : <CheckSquare className="h-3 w-3" />}
            {selectMode ? "Cancel" : "Select"}
          </button>
        )}
      </div>

      {selectMode && (
        <div className="mb-2 flex flex-wrap items-center gap-2 rounded-lg border border-accent/30 bg-accent/5 px-2.5 py-2 text-xs">
          <span className="font-medium text-txt">{selected.size} selected</span>
          {onBulkComplete && (
            <button
              disabled={selected.size === 0}
              onClick={() => {
                onBulkComplete(Array.from(selected));
                exitSelectMode();
              }}
              className="rounded-md border border-border px-2 py-1 text-txt2 hover:bg-surface2 disabled:opacity-40"
            >
              Complete
            </button>
          )}
          {onBulkSetDueDate && (
            <div className="flex items-center gap-1">
              <input
                type="date"
                value={bulkDueDate}
                onChange={(e) => setBulkDueDate(e.target.value)}
                className="rounded-md border border-border bg-bg px-1.5 py-1 text-txt2"
              />
              <button
                disabled={selected.size === 0 || !bulkDueDate}
                onClick={() => {
                  onBulkSetDueDate(Array.from(selected), bulkDueDate);
                  exitSelectMode();
                }}
                className="rounded-md border border-border px-2 py-1 text-txt2 hover:bg-surface2 disabled:opacity-40"
              >
                Reschedule
              </button>
            </div>
          )}
          {onBulkDelete && (
            <button
              disabled={selected.size === 0}
              onClick={() => {
                onBulkDelete(Array.from(selected));
                exitSelectMode();
              }}
              className="rounded-md border border-border px-2 py-1 text-danger hover:bg-danger/10 disabled:opacity-40"
            >
              Delete
            </button>
          )}
        </div>
      )}

      <div className="-mx-1 flex-1 overflow-y-auto px-1">
        <Section title="Overdue" items={overdue} danger />
        <Section title="Today" items={today} />
        <Section title="This week" items={thisWeek} />
        <Section title="Upcoming" items={upcoming} />
        <Section title="Inbox" items={inbox} />
        <Section title="Completed" items={done} />
        {empty && (
          <p className="px-2 py-6 text-center text-xs text-txt3">
            No tasks yet. Try “review deck #work tomorrow p1”, or use the sliders for the full form.
          </p>
        )}
      </div>
    </div>
  );
}
