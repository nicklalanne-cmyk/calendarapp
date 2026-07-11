"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  CheckSquare, CalendarPlus, Link2, Unlink, ExternalLink, Loader2, Plus,
} from "lucide-react";
import clsx from "clsx";
import type { CellLink } from "@/lib/pages";

export type DateAction =
  | { type: "create-task" }
  | { type: "create-event"; time: string; minutes: number }
  | { type: "link" }
  | { type: "unlink" }
  | { type: "open" };

export default function DateCellMenu({
  link,
  busy,
  done,
  onAction,
}: {
  link: CellLink | undefined;
  busy?: boolean;
  /** true when the linked task is completed */
  done?: boolean;
  onAction: (a: DateAction) => void;
}) {
  const [open, setOpen] = useState(false);
  const [time, setTime] = useState("09:00");
  const [mins, setMins] = useState(60);
  const btn = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!open || !btn.current) return;
    const place = () => {
      const r = btn.current!.getBoundingClientRect();
      setPos({
        top: Math.min(r.bottom + 4, window.innerHeight - 250),
        left: Math.min(r.left - 120, window.innerWidth - 250),
      });
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (
        btn.current?.contains(e.target as Node) ||
        (e.target as HTMLElement).closest?.("[data-date-menu]")
      )
        return;
      setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const fire = (a: DateAction) => {
    setOpen(false);
    onAction(a);
  };

  return (
    <>
      <button
        ref={btn}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        title={
          link
            ? link.kind === "task"
              ? `Task: ${link.title}`
              : `Event: ${link.title}`
            : "Turn this date into a task or event"
        }
        className={clsx(
          "flex h-5 w-5 shrink-0 items-center justify-center rounded transition",
          link
            ? done
              ? "text-success"
              : "text-accent"
            : "text-txt3 opacity-60 hover:bg-surface2 md:opacity-0 md:group-hover:opacity-100"
        )}
      >
        {busy ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : link ? (
          link.kind === "task" ? (
            <CheckSquare className="h-3.5 w-3.5" />
          ) : (
            <CalendarPlus className="h-3.5 w-3.5" />
          )
        ) : (
          <Plus className="h-3.5 w-3.5" />
        )}
      </button>

      {open &&
        pos &&
        createPortal(
          <div
            data-date-menu
            style={{ position: "fixed", top: pos.top, left: pos.left }}
            className="z-[80] w-60 rounded-xl border border-border bg-surface p-1.5 shadow-2xl"
          >
            {link ? (
              <>
                <div className="px-2 py-1.5">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-txt3">
                    Linked {link.kind}
                  </p>
                  <p className={clsx("truncate text-sm", done && "text-txt3 line-through")}>
                    {link.title}
                  </p>
                </div>
                <button
                  onClick={() => fire({ type: "open" })}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs text-txt2 hover:bg-surface2"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Open in {link.kind === "task" ? "Planner" : "Agenda"}
                </button>
                <button
                  onClick={() => fire({ type: "unlink" })}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs text-txt3 hover:bg-surface2 hover:text-danger"
                >
                  <Unlink className="h-3.5 w-3.5" /> Unlink
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => fire({ type: "create-task" })}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs text-txt2 hover:bg-surface2"
                >
                  <CheckSquare className="h-3.5 w-3.5 text-accent" />
                  Create a task due this date
                </button>

                <div className="rounded-lg px-2 py-2 hover:bg-surface2">
                  <button
                    onClick={() => fire({ type: "create-event", time, minutes: mins })}
                    className="flex w-full items-center gap-2 text-left text-xs text-txt2"
                  >
                    <CalendarPlus className="h-3.5 w-3.5 text-accent" />
                    Create a calendar event
                  </button>
                  <div className="mt-1.5 flex items-center gap-1 pl-5">
                    <input
                      type="time"
                      value={time}
                      onChange={(e) => setTime(e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      className="rounded border border-border bg-bg px-1.5 py-1 text-[11px] outline-none focus:border-accent"
                    />
                    <select
                      value={mins}
                      onChange={(e) => setMins(Number(e.target.value))}
                      onClick={(e) => e.stopPropagation()}
                      className="rounded border border-border bg-bg px-1.5 py-1 text-[11px] outline-none focus:border-accent"
                    >
                      {[30, 60, 90, 120, 180].map((m) => (
                        <option key={m} value={m}>
                          {m >= 60 ? `${m / 60}h` : `${m}m`}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <button
                  onClick={() => fire({ type: "link" })}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs text-txt2 hover:bg-surface2"
                >
                  <Link2 className="h-3.5 w-3.5" />
                  Link an existing task or event
                </button>
              </>
            )}
          </div>,
          document.body
        )}
    </>
  );
}
