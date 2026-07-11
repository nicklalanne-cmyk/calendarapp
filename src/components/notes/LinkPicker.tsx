"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { X, Search, CheckSquare, CalendarDays, Loader2, Flag } from "lucide-react";
import clsx from "clsx";
import { createClient } from "@/lib/supabase/client";
import type { CalendarEvent, Task } from "@/lib/types";

const PRIORITY_COLOR = ["", "#F06C7C", "#F0A24F", "#56A8F0", "#9A8CF5"];

export type NoteLink =
  | { kind: "task"; task: Task }
  | {
      kind: "event";
      id: string;
      calendarId: string;
      accountId: string;
      title: string;
      start: string;
    };

export default function LinkPicker({
  onClose,
  onPick,
  only,
  title = "Link this note to…",
}: {
  onClose: () => void;
  onPick: (link: NoteLink) => void;
  /** Restrict to one kind (e.g. a task can only link to an event). */
  only?: "task" | "event";
  title?: string;
}) {
  const supabase = createClient();
  const [tab, setTab] = useState<"task" | "event">(only ?? "task");
  const [q, setQ] = useState("");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);

    const { data } = await supabase
      .from("tasks")
      .select("*")
      .is("deleted_at", null)
      .is("parent_id", null)
      .order("is_done", { ascending: true })
      .order("due_date", { ascending: true, nullsFirst: false })
      .limit(200);
    setTasks((data as Task[]) ?? []);

    // a sensible window: last fortnight through the next two months
    const from = new Date();
    from.setDate(from.getDate() - 14);
    const to = new Date();
    to.setMonth(to.getMonth() + 2);
    try {
      const res = await fetch(
        `/api/google/events?timeMin=${from.toISOString()}&timeMax=${to.toISOString()}`
      );
      const j = (await res.json()) as { events?: CalendarEvent[] };
      setEvents(
        (j.events ?? []).sort((a, b) => b.start.localeCompare(a.start))
      );
    } catch {
      setEvents([]);
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);

  const needle = q.trim().toLowerCase();

  const shownTasks = useMemo(
    () =>
      tasks.filter((t) =>
        needle ? t.title.toLowerCase().includes(needle) : true
      ),
    [tasks, needle]
  );

  const shownEvents = useMemo(
    () =>
      events.filter((e) =>
        needle
          ? e.title.toLowerCase().includes(needle) ||
            (e.location ?? "").toLowerCase().includes(needle)
          : true
      ),
    [events, needle]
  );

  const fmt = (iso: string) =>
    new Date(iso).toLocaleString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });

  return (
    <div className="fixed inset-0 z-[75] flex items-end md:items-center md:justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative flex max-h-[80vh] w-full flex-col rounded-t-2xl border-t border-border bg-surface md:max-w-md md:rounded-2xl md:border">
        <div className="flex items-center gap-2 border-b border-border p-3">
          <h2 className="text-sm font-semibold">{title}</h2>
          <button
            onClick={onClose}
            className="ml-auto flex h-9 w-9 items-center justify-center rounded-lg text-txt3 active:bg-surface2"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className={clsx("flex gap-0.5 px-3 pt-3", only && "hidden")}>
          {(
            [
              ["task", "Tasks", CheckSquare],
              ["event", "Events", CalendarDays],
            ] as const
          ).map(([id, label, Icon]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={clsx(
                "flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-sm transition",
                tab === id ? "bg-surface2 text-txt" : "text-txt3 hover:text-txt2"
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </div>

        <div className="p-3 pb-2">
          <div className="flex items-center gap-2 rounded-lg border border-border bg-bg px-2.5">
            <Search className="h-4 w-4 shrink-0 text-txt3" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={tab === "task" ? "Search tasks…" : "Search events…"}
              className="w-full bg-transparent py-2.5 text-sm outline-none placeholder:text-txt3"
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          {loading ? (
            <div className="flex items-center gap-2 px-2 py-6 text-sm text-txt3">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : tab === "task" ? (
            shownTasks.length === 0 ? (
              <p className="px-2 py-6 text-center text-xs text-txt3">No matching tasks.</p>
            ) : (
              shownTasks.map((t) => (
                <button
                  key={t.id}
                  onClick={() => onPick({ kind: "task", task: t })}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2.5 text-left hover:bg-surface2"
                >
                  <CheckSquare
                    className={clsx(
                      "h-4 w-4 shrink-0",
                      t.is_done ? "text-success" : "text-txt3"
                    )}
                  />
                  <span
                    className={clsx(
                      "min-w-0 flex-1 truncate text-sm",
                      t.is_done && "text-txt3 line-through"
                    )}
                  >
                    {t.title}
                  </span>
                  {t.priority > 0 && (
                    <Flag
                      className="h-3 w-3 shrink-0"
                      style={{
                        color: PRIORITY_COLOR[t.priority],
                        fill: PRIORITY_COLOR[t.priority],
                      }}
                    />
                  )}
                  {t.due_date && (
                    <span className="shrink-0 text-[11px] text-txt3">
                      {new Date(`${t.due_date}T00:00:00`).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                      })}
                    </span>
                  )}
                </button>
              ))
            )
          ) : shownEvents.length === 0 ? (
            <p className="px-2 py-6 text-center text-xs text-txt3">
              No matching events in the last 2 weeks or next 2 months.
            </p>
          ) : (
            shownEvents.map((e) => (
              <button
                key={`${e.calendarId}:${e.id}`}
                onClick={() =>
                  onPick({
                    kind: "event",
                    id: e.id,
                    calendarId: e.calendarId,
                    accountId: e.accountId,
                    title: e.title,
                    start: e.start,
                  })
                }
                className="flex w-full items-start gap-2.5 rounded-lg px-2 py-2.5 text-left hover:bg-surface2"
              >
                <span
                  className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                  style={{ background: e.color ?? "#56A8F0" }}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{e.title}</span>
                  <span className="block truncate text-[11px] text-txt3">
                    {e.allDay ? "All day" : fmt(e.start)}
                    {e.location ? ` · ${e.location}` : ""}
                  </span>
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
