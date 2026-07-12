"use client";

import { useState } from "react";
import { CalendarPlus } from "lucide-react";
import clsx from "clsx";
import { toISODate } from "@/lib/recurrence";
import { startOfWeek } from "@/lib/tasks";
import { FOLLOW_UP_QUICK_OPTIONS, addDays } from "@/lib/followup";

/** "Add follow-up" — click/tap a task or event, pick a quick offset (or an
 * exact date), and a new follow-up task gets created due then. Shared by
 * TaskModal and EventModal so the same options/behavior show up everywhere. */
export default function FollowUpMenu({
  base,
  allowWeek,
  onPick,
  compact,
}: {
  /** Date to compute quick offsets from — the task's due date, or the event's start. */
  base: Date;
  /** Show a "Next week" option that creates a due_kind="week" follow-up (for weeklong tasks). */
  allowWeek?: boolean;
  onPick: (dueDate: string, dueKind: "day" | "week") => void;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [customDate, setCustomDate] = useState("");

  const btnCls = compact
    ? "flex items-center gap-1.5 rounded-lg border border-border px-4 py-3 text-sm text-txt2 active:bg-surface2 md:px-3 md:py-2 md:hover:bg-surface"
    : "flex items-center gap-1.5 rounded-lg px-3 py-2.5 text-sm text-txt3 hover:bg-surface2 hover:text-txt md:px-2 md:py-1.5 md:text-xs";

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className={btnCls}>
        <CalendarPlus className="h-4 w-4 md:h-3.5 md:w-3.5" /> Add follow-up
      </button>
    );
  }

  const pick = (dueDate: string, dueKind: "day" | "week") => {
    onPick(dueDate, dueKind);
    setOpen(false);
    setCustomDate("");
  };

  return (
    <div className="w-full rounded-lg border border-border bg-bg p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-txt3">Follow up in…</p>
        <button onClick={() => setOpen(false)} className="text-xs text-txt3 hover:text-txt">
          Cancel
        </button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {FOLLOW_UP_QUICK_OPTIONS.map((o) => (
          <button
            key={o.key}
            onClick={() => pick(toISODate(o.compute(base)), "day")}
            className="rounded-full border border-border px-3 py-1.5 text-xs text-txt2 hover:border-accent hover:text-accent"
          >
            {o.label}
          </button>
        ))}
        {allowWeek && (
          <button
            onClick={() => pick(toISODate(addDays(startOfWeek(base), 7)), "week")}
            className="rounded-full border border-border px-3 py-1.5 text-xs text-txt2 hover:border-accent hover:text-accent"
          >
            Next week
          </button>
        )}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <input
          type="date"
          value={customDate}
          onChange={(e) => setCustomDate(e.target.value)}
          className="flex-1 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-sm outline-none focus:border-accent"
        />
        <button
          disabled={!customDate}
          onClick={() => pick(customDate, "day")}
          className={clsx(
            "rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
          )}
        >
          Set
        </button>
      </div>
    </div>
  );
}
