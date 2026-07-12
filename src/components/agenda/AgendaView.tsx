"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { addDays, format, isSameDay, parseISO } from "date-fns";
import {
  Check, MapPin, Flag, Video, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight,
  ListTodo, X, Loader2,
} from "lucide-react";
import clsx from "clsx";
import { createClient } from "@/lib/supabase/client";
import type { CalendarEvent, Task } from "@/lib/types";
import { dayRange, fmtTime } from "@/lib/dates";
import { getHiddenCals } from "@/lib/calfilter";
import { toISODate } from "@/lib/recurrence";
import { startOfWeek } from "@/lib/tasks";
import { dueChip } from "@/components/tasks/TaskItem";
import { toast } from "@/lib/toast";

const PRIORITY_COLOR = ["", "#F06C7C", "#F0A24F", "#56A8F0", "#9A8CF5"];

export default function AgendaView() {
  const supabase = createClient();
  const [anchor, setAnchor] = useState(new Date());
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [tasksOpen, setTasksOpen] = useState(false);
  const [mode, setMode] = useState<"day" | "week">("day");
  const touchX = useRef<number | null>(null);

  const strip = useMemo(() => {
    const s0 = startOfWeek(anchor);
    return Array.from({ length: 7 }, (_, i) => addDays(s0, i));
  }, [anchor]);

  // Week mode is a plain Sunday-start list of that week's tasks, day by
  // day — not a calendar grid. Day mode still shows the day's events too.
  const days = useMemo(() => (mode === "week" ? strip : [anchor]), [mode, anchor, strip]);

  const reqSeq = useRef(0);

  const load = useCallback(async () => {
    if (days.length === 0) return;
    const seq = ++reqSeq.current;
    setLoading(true);
    const start = dayRange(days[0]).start;
    const end = dayRange(days[days.length - 1]).end;
    const params = new URLSearchParams({
      timeMin: start.toISOString(),
      timeMax: end.toISOString(),
    });
    try {
      const res = await fetch(`/api/google/events?${params.toString()}`);
      const j = (await res.json()) as { events?: CalendarEvent[] };
      if (seq !== reqSeq.current) return;
      setEvents(j.events ?? []);
    } catch {
      if (seq !== reqSeq.current) return;
      setEvents([]);
    }
    const { data } = await supabase.from("tasks").select("*").eq("is_done", false).is("deleted_at", null);
    if (seq !== reqSeq.current) return;
    setTasks((data as Task[]) ?? []);
    setLoading(false);
  }, [supabase, days]);

  useEffect(() => {
    setHidden(getHiddenCals());
    const h = () => setHidden(getHiddenCals());
    window.addEventListener("cadence:cals-changed", h);
    return () => window.removeEventListener("cadence:cals-changed", h);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const h = () => load();
    window.addEventListener("cadence:ai-mutated", h);
    window.addEventListener("cadence:tasks-changed", h);
    return () => {
      window.removeEventListener("cadence:ai-mutated", h);
      window.removeEventListener("cadence:tasks-changed", h);
    };
  }, [load]);

  const completeTask = async (t: Task) => {
    const { error } = await supabase.from("tasks").update({ is_done: true }).eq("id", t.id);
    if (error) return toast(error.message, "error");
    load();
  };

  const shift = (dir: 1 | -1) => setAnchor((d) => addDays(d, dir));
  const shiftWeek = (dir: 1 | -1) => setAnchor((d) => addDays(d, dir * 7));

  const visibleEvents = events.filter((e) => !hidden.has(e.calendarId));
  const todayStr = format(new Date(), "yyyy-MM-dd");
  const rangeStart = toISODate(days[0] ?? new Date());
  const rangeEnd = toISODate(days[days.length - 1] ?? new Date());

  const title =
    mode === "week"
      ? `${format(strip[0], "MMM d")} – ${format(strip[6], "MMM d")}`
      : format(anchor, "EEEE, MMM d");

  // tasks with a due date inside the visible range (week-due tasks land on their week start)
  const openTasks = tasks.filter((t) => !t.parent_id);
  const inRange = openTasks.filter(
    (t) => t.due_date && t.due_date >= rangeStart && t.due_date <= rangeEnd
  );
  const overdue = openTasks
    .filter((t) => t.due_date && t.due_date < todayStr)
    .sort((a, b) => (a.priority || 99) - (b.priority || 99));
  const unscheduled = openTasks
    .filter((t) => !t.due_date)
    .sort((a, b) => (a.priority || 99) - (b.priority || 99));

  const TaskRow = ({ t, showDue }: { t: Task; showDue?: boolean }) => {
    const chip = t.due_date ? dueChip(t.due_date, t.due_kind ?? "day") : null;
    return (
      <div className="group flex items-center gap-2.5 rounded-lg px-2 py-2.5 hover:bg-surface2 md:py-1.5">
        <button
          onClick={() => completeTask(t)}
          aria-label={`Mark "${t.title}" done`}
          className="-m-1.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 border-txt3 p-1.5 transition active:bg-accent active:text-white md:m-0 md:h-[18px] md:w-[18px] md:border md:p-0 md:hover:border-accent md:hover:bg-accent md:hover:text-white"
        >
          <Check className="h-4 w-4 opacity-40 active:opacity-100 md:h-2.5 md:w-2.5 md:opacity-0 md:group-hover:opacity-100" />
        </button>
        {t.priority > 0 && (
          <Flag
            className="h-3 w-3 shrink-0"
            style={{ color: PRIORITY_COLOR[t.priority], fill: PRIORITY_COLOR[t.priority] }}
          />
        )}
        <span className="min-w-0 flex-1 truncate text-[15px] text-txt md:text-sm">{t.title}</span>
        {showDue && chip && (
          <span
            className={clsx(
              "shrink-0 whitespace-nowrap text-[11px]",
              chip.overdue ? "text-danger" : "text-txt3"
            )}
          >
            {chip.label}
          </span>
        )}
      </div>
    );
  };

  const taskPanel = (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      <Bucket title="Overdue" count={overdue.length} danger>
        {overdue.map((t) => (
          <TaskRow key={t.id} t={t} showDue />
        ))}
      </Bucket>
      <Bucket title={isSameDay(anchor, new Date()) ? "Due today" : "Due this day"} count={inRange.length}>
        {inRange.map((t) => (
          <TaskRow key={t.id} t={t} showDue />
        ))}
      </Bucket>
      <Bucket title="Unscheduled" count={unscheduled.length}>
        {unscheduled.map((t) => (
          <TaskRow key={t.id} t={t} />
        ))}
      </Bucket>
    </div>
  );

  return (
    <div className="flex h-full min-w-0">
      <div className="flex min-w-0 flex-1 flex-col">
        {/* desktop header */}
        <header className="hidden items-center gap-2 border-b border-border px-4 py-2.5 md:flex">
          <h1 className="text-lg font-semibold">{title}</h1>
          <div className="ml-1 flex items-center">
            <button
              onClick={() => shiftWeek(-1)}
              title="Previous week"
              className="rounded-md p-1 text-txt3 hover:bg-surface hover:text-txt"
            >
              <ChevronsLeft className="h-4 w-4" />
            </button>
            <button
              onClick={() => shift(-1)}
              title="Previous day"
              className="rounded-md p-1 text-txt3 hover:bg-surface hover:text-txt"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              onClick={() => shift(1)}
              title="Next day"
              className="rounded-md p-1 text-txt3 hover:bg-surface hover:text-txt"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            <button
              onClick={() => shiftWeek(1)}
              title="Next week"
              className="rounded-md p-1 text-txt3 hover:bg-surface hover:text-txt"
            >
              <ChevronsRight className="h-4 w-4" />
            </button>
          </div>
          <button
            onClick={() => setAnchor(new Date())}
            className="rounded-md border border-border px-2 py-1 text-xs text-txt2 hover:bg-surface"
          >
            Today
          </button>
          <div className="ml-1 flex overflow-hidden rounded-md border border-border text-xs">
            {(["day", "week"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={
                  m === mode
                    ? "px-2 py-1 font-medium text-white bg-accent"
                    : "px-2 py-1 text-txt2 hover:bg-surface"
                }
              >
                {m === "day" ? "Day" : "Week"}
              </button>
            ))}
          </div>
          {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-txt3" />}
          <div className="ml-auto flex items-center gap-2">
            <input
              type="date"
              value={toISODate(anchor)}
              onChange={(e) =>
                e.target.value && setAnchor(new Date(`${e.target.value}T00:00:00`))
              }
              className="rounded-lg border border-border bg-surface px-2 py-1 text-xs text-txt2 outline-none focus:border-accent"
            />
          </div>
        </header>

        {/* mobile: title + week arrows, then an evenly-gridded 7-day strip */}
        <header className="shrink-0 border-b border-border px-4 pb-2 md:hidden">
          <div className="flex items-center gap-2 py-1">
            <h1 className="min-w-0 truncate text-lg font-semibold">
              {mode === "week" ? title : format(anchor, "EEE, MMM d")}
            </h1>
            {loading && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-txt3" />}

            <div className="ml-auto flex shrink-0 items-center gap-1">
              <button
                onClick={() => setMode((m) => (m === "day" ? "week" : "day"))}
                className="rounded-full border border-border px-3 py-1.5 text-xs text-txt2 active:bg-surface2"
              >
                {mode === "day" ? "Week" : "Day"}
              </button>
              <button
                onClick={() => shiftWeek(-1)}
                aria-label="Previous week"
                className="flex h-10 w-10 items-center justify-center rounded-full text-txt2 active:bg-surface2"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <button
                onClick={() => shiftWeek(1)}
                aria-label="Next week"
                className="flex h-10 w-10 items-center justify-center rounded-full text-txt2 active:bg-surface2"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
              <button
                onClick={() => setAnchor(new Date())}
                className="rounded-full border border-border px-3 py-1.5 text-xs text-txt2 active:bg-surface2"
              >
                Today
              </button>
              <button
                onClick={() => setTasksOpen(true)}
                aria-label="Tasks"
                className="flex items-center gap-1 rounded-full border border-border px-3 py-1.5 text-xs text-txt2 active:bg-surface2"
              >
                <ListTodo className="h-3.5 w-3.5" />
                {overdue.length + inRange.length}
              </button>
            </div>
          </div>

          {/* a 7-column grid can't drift: every day gets exactly 1/7 of the width */}
          <div className="grid grid-cols-7">
            {strip.map((d) => {
              const sel = isSameDay(d, anchor);
              const isTd = isSameDay(d, new Date());
              return (
                <button
                  key={d.toISOString()}
                  onClick={() => {
                    setAnchor(d);
                    setMode("day");
                  }}
                  className="flex flex-col items-center gap-1 py-1.5 active:opacity-60"
                >
                  <span
                    className={clsx(
                      "text-[11px] font-medium uppercase",
                      sel ? "text-accent" : "text-txt3"
                    )}
                  >
                    {format(d, "EEEEE")}
                  </span>
                  <span
                    className={clsx(
                      "flex h-9 w-9 items-center justify-center rounded-full text-[15px] tabular-nums transition",
                      sel
                        ? "bg-accent font-semibold text-white"
                        : isTd
                          ? "font-semibold text-accent"
                          : "text-txt2"
                    )}
                  >
                    {format(d, "d")}
                  </span>
                </button>
              );
            })}
          </div>
        </header>

        <div
          className="min-h-0 flex-1 overflow-y-auto"
          onTouchStart={(e) => {
            touchX.current = e.touches[0].clientX;
          }}
          onTouchEnd={(e) => {
            if (touchX.current == null) return;
            const dx = e.changedTouches[0].clientX - touchX.current;
            if (Math.abs(dx) > 60) shiftWeek(dx < 0 ? 1 : -1);
            touchX.current = null;
          }}
        >
          <div className="mx-auto max-w-3xl p-4 md:p-6">
            {days.map((day) => {
              const dayStr = format(day, "yyyy-MM-dd");
              const isToday = dayStr === todayStr;
              const dayEvents =
                mode === "day"
                  ? visibleEvents
                      .filter((e) => isSameDay(parseISO(e.start), day))
                      .sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start.localeCompare(b.start))
                  : [];
              const dayTasks = openTasks
                .filter(
                  (t) =>
                    (t.due_kind ?? "day") === "day"
                      ? t.due_date === dayStr
                      : t.due_date === dayStr // week tasks show on their week's first day
                )
                .sort((a, b) => (a.priority || 99) - (b.priority || 99));

              const emptyDay = dayEvents.length === 0 && dayTasks.length === 0;

              return (
                <div key={dayStr} className="mb-5">
                  <div className="mb-2 flex items-baseline gap-2 border-b border-border pb-1">
                    <span
                      className={clsx(
                        "text-sm font-semibold",
                        isToday ? "text-accent" : "text-txt"
                      )}
                    >
                      {isToday ? "Today" : format(day, "EEEE")}
                    </span>
                    <span className="text-xs text-txt3">{format(day, "MMM d")}</span>
                    {emptyDay && <span className="ml-auto text-xs text-txt3">Nothing scheduled</span>}
                  </div>

                  {dayTasks.map((t) => (
                    <TaskRow key={t.id} t={t} showDue={(t.due_kind ?? "day") === "week"} />
                  ))}

                  {dayEvents.map((e) => (
                    <div
                      key={`${e.calendarId}:${e.id}`}
                      className="flex items-start gap-3 rounded-lg px-2 py-2.5 hover:bg-surface2 md:py-1.5"
                    >
                      <span className="mt-0.5 w-[70px] shrink-0 whitespace-nowrap text-xs tabular-nums text-txt3">
                        {e.allDay ? "All day" : fmtTime(parseISO(e.start))}
                      </span>
                      <span
                        className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                        style={{ background: e.color ?? "#56A8F0" }}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[15px] text-txt md:text-sm">{e.title}</div>
                        <div className="flex items-center gap-3 text-[11px] text-txt3">
                          {e.location && (
                            <span className="flex min-w-0 items-center gap-1">
                              <MapPin className="h-3 w-3 shrink-0" />
                              <span className="truncate">{e.location}</span>
                            </span>
                          )}
                          {e.meetingLink && (
                            <a
                              href={e.meetingLink}
                              target="_blank"
                              rel="noreferrer"
                              className="flex shrink-0 items-center gap-1 text-accentSoft hover:underline"
                            >
                              <Video className="h-3 w-3" /> Join
                            </a>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* task sidebar — always on wide screens, drawer on small */}
      <aside className="hidden w-[300px] shrink-0 border-l border-border lg:block">
        {taskPanel}
      </aside>

      {tasksOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" onClick={() => setTasksOpen(false)}>
          <div className="absolute inset-0 bg-black/40" />
          <aside
            className="absolute right-0 top-0 h-full w-[85%] max-w-[340px] border-l border-border bg-surface"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <span className="text-sm font-semibold">Tasks</span>
              <button
                onClick={() => setTasksOpen(false)}
                className="rounded p-1 text-txt3 hover:bg-surface2 hover:text-txt"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="h-[calc(100%-49px)]">{taskPanel}</div>
          </aside>
        </div>
      )}
    </div>
  );
}

function Bucket({
  title,
  count,
  danger,
  children,
}: {
  title: string;
  count: number;
  danger?: boolean;
  children: React.ReactNode;
}) {
  if (count === 0) return null;
  return (
    <div>
      <div
        className={clsx(
          "px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide",
          danger ? "text-danger" : "text-txt3"
        )}
      >
        {title} <span className="text-txt3">{count}</span>
      </div>
      {children}
    </div>
  );
}
