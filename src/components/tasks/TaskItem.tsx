"use client";

import { useState } from "react";
import type { Task } from "@/lib/types";
import { Check, GripVertical, Trash2, Flag, Repeat, Plus, Hash, FileText, Clock, CalendarPlus, CalendarDays, Users } from "lucide-react";
import clsx from "clsx";
import { format, parseISO } from "date-fns";

const PRIORITY_COLOR = ["", "#F06C7C", "#F0A24F", "#56A8F0", "#9A8CF5"];

export function dueChip(due: string, kind: "day" | "week"): { label: string; overdue: boolean } {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = parseISO(due);

  if (kind === "week") {
    const end = new Date(d);
    end.setDate(end.getDate() + 6);
    const thisWeek = new Date(today);
    thisWeek.setDate(thisWeek.getDate() - thisWeek.getDay());
    const weeks = Math.round((d.getTime() - thisWeek.getTime()) / (7 * 86400000));
    const label =
      weeks === 0 ? "This week" : weeks === 1 ? "Next week" : `Week of ${format(d, "MMM d")}`;
    return { label, overdue: end < today };
  }

  const diff = Math.round((d.getTime() - today.getTime()) / 86400000);
  const label =
    diff === 0 ? "Today"
      : diff === 1 ? "Tomorrow"
      : diff === -1 ? "Yesterday"
      : format(d, "MMM d");
  return { label, overdue: diff < 0 };
}

function estimateLabel(m: number) {
  return m >= 60 ? `${Math.round((m / 60) * 10) / 10}h` : `${m}m`;
}

export default function TaskItem({
  task,
  subtasks,
  onToggle,
  onDelete,
  onCyclePriority,
  onAddSubtask,
  onOpenNote,
  onOpenTask,
  onSchedule,
}: {
  task: Task;
  subtasks: Task[];
  onToggle: (t: Task) => void;
  onDelete: (t: Task) => void;
  onCyclePriority: (t: Task) => void;
  onAddSubtask: (parent: Task, title: string) => void;
  onOpenNote: (t: Task) => void;
  onOpenTask: (t: Task) => void;
  onSchedule: (t: Task) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [sub, setSub] = useState("");
  const chip = task.due_date ? dueChip(task.due_date, task.due_kind ?? "day") : null;
  const pColor = task.priority > 0 ? PRIORITY_COLOR[task.priority] : undefined;
  const doneCount = subtasks.filter((s) => s.is_done).length;
  const tags = task.tags ?? [];
  const repeats = Boolean(task.rrule || task.repeat);

  const submitSub = () => {
    const v = sub.trim();
    if (!v) return;
    onAddSubtask(task, v);
    setSub("");
    setAdding(false);
  };

  return (
    <div>
      <div
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(
            "application/cadence-task",
            JSON.stringify({ id: task.id, title: task.title })
          );
          e.dataTransfer.effectAllowed = "copy";
        }}
        className="group relative flex items-start gap-2 rounded-lg border border-transparent py-2.5 pl-1 pr-1 hover:border-border hover:bg-surface md:items-center md:py-1.5"
      >
        <GripVertical className="hidden h-3.5 w-3.5 shrink-0 cursor-grab text-txt3 opacity-30 transition-opacity group-hover:opacity-100 md:block" />

        <button
          onClick={() => onToggle(task)}
          aria-label={task.is_done ? "Mark incomplete" : "Mark complete"}
          className={clsx(
            "ml-1 mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition md:ml-0 md:mt-0 md:h-[18px] md:w-[18px] md:border",
            task.is_done ? "border-accent bg-accent text-white" : "border-txt3 hover:border-accent"
          )}
        >
          {task.is_done && <Check className="h-3.5 w-3.5 md:h-2.5 md:w-2.5" />}
        </button>

        {/* content — must be allowed to shrink, and never wrap */}
        <div className="min-w-0 flex-1">
          <button
            onClick={() => onOpenTask(task)}
            className={clsx(
              "block w-full truncate text-left text-[15px] leading-5 hover:underline md:text-sm",
              task.is_done ? "text-txt3 line-through" : "text-txt"
            )}
          >
            {task.title}
          </button>

          {(chip || task.project || repeats || task.estimate_minutes || tags.length > 0 || subtasks.length > 0) && (
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs leading-4 md:mt-0.5 md:text-[11px]">
              {chip && (
                <span
                  className={clsx(
                    "shrink-0 whitespace-nowrap tabular-nums",
                    chip.overdue && !task.is_done ? "text-danger" : "text-txt3"
                  )}
                >
                  {chip.label}
                </span>
              )}
              {task.project && (
                <span className="flex shrink-0 items-center gap-0.5 whitespace-nowrap text-accentSoft">
                  <Hash className="h-2.5 w-2.5 shrink-0" />
                  {task.project}
                </span>
              )}
              {repeats && <Repeat className="h-3 w-3 shrink-0 text-txt3" />}
              {task.shared && (
                <span title="Shared with partner" className="flex shrink-0 items-center text-accentSoft">
                  <Users className="h-3 w-3" />
                </span>
              )}
              {task.linked_event_id && (
                <span
                  className="flex shrink-0 items-center gap-0.5 whitespace-nowrap text-accentSoft"
                  title={`Meeting: ${task.linked_event_title ?? ""}`}
                >
                  <CalendarDays className="h-2.5 w-2.5 shrink-0" />
                  <span className="max-w-[110px] truncate">{task.linked_event_title}</span>
                </span>
              )}
              {task.estimate_minutes ? (
                <span className="flex shrink-0 items-center gap-0.5 whitespace-nowrap text-txt3">
                  <Clock className="h-2.5 w-2.5 shrink-0" />
                  {estimateLabel(task.estimate_minutes)}
                </span>
              ) : null}
              {tags.slice(0, 2).map((tg) => (
                <span
                  key={tg}
                  className="shrink-0 truncate rounded bg-surface2 px-1 text-success"
                  style={{ maxWidth: 110 }}
                >
                  {tg}
                </span>
              ))}
              {tags.length > 2 && <span className="shrink-0 text-txt3">+{tags.length - 2}</span>}
              {subtasks.length > 0 && (
                <span className="shrink-0 text-txt3 tabular-nums">
                  {doneCount}/{subtasks.length}
                </span>
              )}
            </div>
          )}

          {/* actions — mobile only, own row so it never collides with the meta chips above */}
          <div className="mt-1 flex items-center gap-1 md:hidden">
            <button
              onClick={() => onSchedule(task)}
              title="Add to calendar"
              className="rounded-lg p-1.5 text-txt3 active:bg-surface2"
            >
              <CalendarPlus className="h-4 w-4" />
            </button>
            <button
              onClick={() => onOpenNote(task)}
              title="Open linked note"
              className="rounded-lg p-1.5 text-txt3 active:bg-surface2"
            >
              <FileText className="h-4 w-4" />
            </button>
            <button
              onClick={() => setAdding((v) => !v)}
              title="Add subtask"
              className="rounded-lg p-1.5 text-txt3 active:bg-surface2"
            >
              <Plus className="h-4 w-4" />
            </button>
            <button
              onClick={() => onCyclePriority(task)}
              title="Cycle priority"
              className="rounded-lg p-1.5 active:bg-surface2"
            >
              <Flag
                className="h-4 w-4"
                style={{ color: pColor ?? "#6E6E7A", fill: pColor ?? "transparent" }}
              />
            </button>
            <button
              onClick={() => onDelete(task)}
              title="Delete"
              className="ml-auto rounded-lg p-1.5 text-txt3 active:bg-surface2"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* actions — desktop only here; fixed cluster, floats over the meta row on hover so nothing collides */}
        <div className="ml-auto hidden shrink-0 items-center gap-0.5 rounded-md pl-1 transition md:flex md:bg-surface md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100">
          <button
            onClick={() => onSchedule(task)}
            title="Add to calendar"
            className="rounded-lg p-1 text-txt3 hover:bg-surface2 hover:text-txt"
          >
            <CalendarPlus className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => onOpenNote(task)}
            title="Open linked note"
            className="rounded-lg p-1 text-txt3 hover:bg-surface2 hover:text-txt"
          >
            <FileText className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => setAdding((v) => !v)}
            title="Add subtask"
            className="rounded-lg p-1 text-txt3 hover:bg-surface2 hover:text-txt"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => onCyclePriority(task)}
            title="Cycle priority"
            className="rounded-lg p-1 hover:bg-surface2"
          >
            <Flag
              className="h-3.5 w-3.5"
              style={{ color: pColor ?? "#6E6E7A", fill: pColor ?? "transparent" }}
            />
          </button>
          <button
            onClick={() => onDelete(task)}
            title="Delete"
            className="rounded-lg p-1 text-txt3 hover:bg-surface2 hover:text-danger"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* priority flag stays visible when set and the row isn't hovered */}
        {pColor && (
          <Flag
            aria-hidden
            className="pointer-events-none absolute right-2 hidden h-3.5 w-3.5 md:block md:group-hover:hidden"
            style={{ color: pColor, fill: pColor }}
          />
        )}
      </div>

      {(subtasks.length > 0 || adding) && (
        <div className="ml-[26px] border-l border-border pl-2">
          {subtasks.map((st) => (
            <div key={st.id} className="group/s flex items-center gap-2 rounded px-1 py-2 hover:bg-surface md:py-1">
              <button
                onClick={() => onToggle(st)}
                className={clsx(
                  "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 md:h-4 md:w-4 md:border",
                  st.is_done ? "border-accent bg-accent text-white" : "border-txt3"
                )}
              >
                {st.is_done && <Check className="h-2.5 w-2.5" />}
              </button>
              <span
                className={clsx(
                  "min-w-0 flex-1 truncate text-sm md:text-xs",
                  st.is_done ? "text-txt3 line-through" : "text-txt2"
                )}
              >
                {st.title}
              </span>
              <button
                onClick={() => onDelete(st)}
                className="shrink-0 rounded-lg p-1.5 text-txt3 transition active:bg-surface2 md:p-0 md:opacity-0 md:hover:text-danger md:group-hover/s:opacity-100"
              >
                <Trash2 className="h-4 w-4 md:h-3 md:w-3" />
              </button>
            </div>
          ))}
          {adding && (
            <input
              autoFocus
              value={sub}
              onChange={(e) => setSub(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitSub();
                if (e.key === "Escape") setAdding(false);
              }}
              onBlur={() => (sub.trim() ? submitSub() : setAdding(false))}
              placeholder="Subtask…"
              className="w-full bg-transparent px-1 py-1 text-xs outline-none placeholder:text-txt3"
            />
          )}
        </div>
      )}
    </div>
  );
}
