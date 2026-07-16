"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import { Plus, Hash, SlidersHorizontal, ChevronDown, ChevronRight } from "lucide-react";
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
  onOpenNote,
  onOpenTask,
  onNewTask,
  onSchedule,
}: {
  tasks: Task[];
  onAdd: (parsed: ParsedTask) => void;
  onToggle: (t: Task) => void;
  onDelete: (t: Task) => void;
  onCyclePriority: (t: Task) => void;
  onAddSubtask: (parent: Task, title: string) => void;
  onOpenNote: (t: Task) => void;
  onOpenTask: (t: Task) => void;
  onNewTask: () => void;
  onSchedule: (t: Task) => void;
}) {
  const [value, setValue] = useState("");
  const [projectFilter, setProjectFilter] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const todayStr = format(new Date(), "yyyy-MM-dd");

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
          items.map((t) => (
            <TaskItem
              key={t.id}
              task={t}
              subtasks={children.get(t.id) ?? []}
              onToggle={onToggle}
              onDelete={onDelete}
              onCyclePriority={onCyclePriority}
              onAddSubtask={onAddSubtask}
              onOpenNote={onOpenNote}
              onOpenTask={onOpenTask}
              onSchedule={onSchedule}
            />
          ))}
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

      {projects.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1">
          <button
            onClick={() => setProjectFilter(null)}
            className={`rounded-full px-3 py-1.5 text-xs md:px-2 md:py-0.5 md:text-[11px] ${
              projectFilter === null ? "bg-accent text-white" : "bg-surface text-txt3 hover:text-txt"
            }`}
          >
            All
          </button>
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
