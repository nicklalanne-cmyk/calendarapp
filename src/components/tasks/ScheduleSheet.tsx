"use client";

import { useState } from "react";
import { X, Clock } from "lucide-react";
import clsx from "clsx";
import type { Task } from "@/lib/types";
import { toISODate } from "@/lib/recurrence";

const DURATIONS = [15, 30, 45, 60, 90, 120];

function roundToNext15(d: Date) {
  const x = new Date(d);
  x.setMinutes(Math.ceil(x.getMinutes() / 15) * 15, 0, 0);
  return x;
}

/** Time-block a task from a phone, where drag-and-drop doesn't exist. */
export default function ScheduleSheet({
  task,
  onClose,
  onSchedule,
}: {
  task: Task;
  onClose: () => void;
  onSchedule: (start: Date, end: Date) => void;
}) {
  const now = roundToNext15(new Date());
  const initialDate = task.due_date && (task.due_kind ?? "day") === "day"
    ? task.due_date
    : toISODate(new Date());

  const [date, setDate] = useState(initialDate);
  const [time, setTime] = useState(
    `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`
  );
  const [mins, setMins] = useState(task.estimate_minutes || 60);

  const go = () => {
    const start = new Date(`${date}T${time}:00`);
    if (isNaN(start.getTime())) return;
    const end = new Date(start.getTime() + mins * 60000);
    onSchedule(start, end);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center md:justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full rounded-t-2xl border-t border-border bg-surface p-4 pb-8 md:max-w-sm md:rounded-2xl md:border md:pb-4">
        <div className="mb-4 flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-xs text-txt3">
              <Clock className="h-3.5 w-3.5" /> Schedule
            </div>
            <h2 className="mt-0.5 truncate text-base font-semibold">{task.title}</h2>
          </div>
          <button
            onClick={onClose}
            className="-mr-1 -mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-txt3 active:bg-surface2"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mb-3 grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-txt3">
              Date
            </label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full rounded-lg border border-border bg-bg px-3 py-2.5 text-base outline-none focus:border-accent"
            />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-txt3">
              Start
            </label>
            <input
              type="time"
              value={time}
              step={900}
              onChange={(e) => setTime(e.target.value)}
              className="w-full rounded-lg border border-border bg-bg px-3 py-2.5 text-base outline-none focus:border-accent"
            />
          </div>
        </div>

        <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-txt3">
          Duration
        </label>
        <div className="mb-5 grid grid-cols-3 gap-2">
          {DURATIONS.map((m) => (
            <button
              key={m}
              onClick={() => setMins(m)}
              className={clsx(
                "rounded-lg border py-2.5 text-sm transition",
                mins === m
                  ? "border-accent bg-accent/10 text-accent"
                  : "border-border text-txt2 active:bg-surface2"
              )}
            >
              {m >= 60 ? `${m / 60}h${m % 60 ? ` ${m % 60}m` : ""}` : `${m}m`}
            </button>
          ))}
        </div>

        <button
          onClick={go}
          className="w-full rounded-xl bg-accent py-3.5 text-sm font-medium text-white active:opacity-80"
        >
          Add to calendar
        </button>
      </div>
    </div>
  );
}
