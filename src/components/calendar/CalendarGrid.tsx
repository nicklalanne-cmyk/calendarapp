"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CalendarEvent } from "@/lib/types";
import { HOURS, weekDays, fmtTime, minutesOfDay } from "@/lib/dates";
import { format, isSameDay } from "date-fns";
import clsx from "clsx";
import { CheckSquare } from "lucide-react";

const HOUR_H = 48;
const GUTTER = 56;

export type TaskDropPayload = { id: string; title: string; estimate_minutes?: number | null };

const snap = (m: number) => Math.round(m / 15) * 15;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
function hourLabel(h: number) {
  const ap = h < 12 ? "AM" : "PM";
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr} ${ap}`;
}
function startMinOf(e: CalendarEvent) {
  return minutesOfDay(new Date(e.start));
}
function endMinOf(e: CalendarEvent) {
  const s = startMinOf(e);
  let en = minutesOfDay(new Date(e.end));
  if (en <= s) en = 1440;
  return en;
}

type Positioned = { ev: CalendarEvent; s: number; en: number; left: number; width: number };

function layoutDay(events: CalendarEvent[]): Positioned[] {
  const evs = events
    .filter((e) => !e.allDay)
    .map((e) => ({ ev: e, s: startMinOf(e), en: endMinOf(e) }))
    .sort((a, b) => a.s - b.s || b.en - a.en);

  const out: Positioned[] = [];
  let group: typeof evs = [];
  let groupEnd = -1;

  const flush = (g: typeof evs) => {
    if (g.length === 0) return;
    const laneEnds: number[] = [];
    const lane = new Map<number, number>();
    g.forEach((it, idx) => {
      let placed = -1;
      for (let i = 0; i < laneEnds.length; i++) {
        if (laneEnds[i] <= it.s) {
          laneEnds[i] = it.en;
          placed = i;
          break;
        }
      }
      if (placed === -1) {
        laneEnds.push(it.en);
        placed = laneEnds.length - 1;
      }
      lane.set(idx, placed);
    });
    const cols = laneEnds.length;
    g.forEach((it, idx) => {
      const l = lane.get(idx) ?? 0;
      out.push({ ev: it.ev, s: it.s, en: it.en, left: l / cols, width: 1 / cols });
    });
  };

  for (const it of evs) {
    if (group.length > 0 && it.s >= groupEnd) {
      flush(group);
      group = [];
      groupEnd = -1;
    }
    group.push(it);
    groupEnd = Math.max(groupEnd, it.en);
  }
  flush(group);
  return out;
}

export default function CalendarGrid({
  view,
  date,
  events,
  onCreate,
  onEventClick,
  onDropTask,
  onMoveEvent,
  onResizeEvent,
  onPickDay,
}: {
  view: "day" | "week";
  date: Date;
  events: CalendarEvent[];
  onCreate: (start: Date, end: Date) => void;
  onEventClick: (ev: CalendarEvent) => void;
  onDropTask: (payload: TaskDropPayload, start: Date, end: Date) => void;
  onMoveEvent: (ev: CalendarEvent, start: Date, end: Date) => void;
  onResizeEvent: (ev: CalendarEvent, end: Date) => void;
  onPickDay?: (d: Date) => void;
}) {
  const days = view === "day" ? [date] : weekDays(date);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (!scrollRef.current) return;
    const h = new Date().getHours();
    scrollRef.current.scrollTop = Math.max(0, (h - 2) * HOUR_H);
  }, []);

  const anyAllDay = events.some((e) => e.allDay);

  return (
    <div className="flex h-full flex-col">
      <div className="flex border-b border-border" style={{ paddingLeft: GUTTER }}>
        {days.map((d) => (
          <button
            key={d.toISOString()}
            onClick={() => onPickDay?.(d)}
            className="flex-1 rounded-md py-2 text-center hover:bg-surface"
          >
            <div className="text-xs text-txt3">{format(d, "EEE")}</div>
            <div
              className={clsx(
                "text-sm font-semibold",
                isSameDay(d, new Date()) ? "text-accent" : "text-txt2"
              )}
            >
              {format(d, "d")}
            </div>
          </button>
        ))}
      </div>

      {anyAllDay && (
        <div className="flex border-b border-border" style={{ paddingLeft: GUTTER }}>
          {days.map((d) => {
            const allday = events.filter((e) => e.allDay && isSameDay(new Date(e.start), d));
            return (
              <div key={d.toISOString()} className="min-w-0 flex-1 space-y-0.5 p-1">
                {allday.map((ev) => (
                  <button
                    key={ev.id}
                    onClick={() => onEventClick(ev)}
                    className="block w-full truncate rounded px-1.5 py-0.5 text-left text-[11px]"
                    style={{ backgroundColor: ev.color ? `${ev.color}33` : "rgba(124,108,240,0.25)" }}
                  >
                    {ev.title}
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      )}

      <div ref={scrollRef} className="flex flex-1 overflow-y-auto">
        <div className="shrink-0" style={{ width: GUTTER }}>
          {HOURS.map((h) => (
            <div key={h} style={{ height: HOUR_H }} className="relative">
              <span className="absolute -top-2 right-2 text-[10px] text-txt3">
                {h > 0 ? hourLabel(h) : ""}
              </span>
            </div>
          ))}
        </div>

        {days.map((d) => (
          <DayColumn
            key={d.toISOString()}
            day={d}
            now={now}
            events={events}
            onCreate={onCreate}
            onEventClick={onEventClick}
            onDropTask={onDropTask}
            onMoveEvent={onMoveEvent}
            onResizeEvent={onResizeEvent}
          />
        ))}
      </div>
    </div>
  );
}

type Ptr =
  | { mode: "create"; startY: number; curY: number }
  | { mode: "move"; curY: number; ev: CalendarEvent; grabOffsetMin: number; durMin: number; moved: boolean }
  | { mode: "resize"; curY: number; ev: CalendarEvent; origStartMin: number };

function DayColumn({
  day,
  now,
  events,
  onCreate,
  onEventClick,
  onDropTask,
  onMoveEvent,
  onResizeEvent,
}: {
  day: Date;
  now: Date;
  events: CalendarEvent[];
  onCreate: (start: Date, end: Date) => void;
  onEventClick: (ev: CalendarEvent) => void;
  onDropTask: (payload: TaskDropPayload, start: Date, end: Date) => void;
  onMoveEvent: (ev: CalendarEvent, start: Date, end: Date) => void;
  onResizeEvent: (ev: CalendarEvent, end: Date) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [ptr, setPtr] = useState<Ptr | null>(null);

  const positioned = useMemo(
    () => layoutDay(events.filter((e) => isSameDay(new Date(e.start), day))),
    [events, day]
  );

  const relY = (clientY: number) => {
    const rect = ref.current?.getBoundingClientRect();
    return rect ? clientY - rect.top : 0;
  };
  const yToMin = (y: number) => clamp(Math.round((y / HOUR_H) * 60), 0, 1440);
  const dateAt = (min: number) => {
    const d = new Date(day);
    d.setHours(0, min, 0, 0);
    return d;
  };

  const onMouseUp = () => {
    if (!ptr) return;
    if (ptr.mode === "create") {
      // handled in the drag-layer's own up via shared state below
    }
    setPtr(null);
  };

  return (
    <div ref={ref} className="relative flex-1 border-l border-border" style={{ height: 24 * HOUR_H }}>
      {/* Grid lines + create-drag capture layer */}
      <div
        className="absolute inset-0"
        onMouseDown={(e) => {
          if (e.button !== 0) return;
          const y = relY(e.clientY);
          setPtr({ mode: "create", startY: y, curY: y });
        }}
        onMouseMove={(e) => {
          if (!ptr) return;
          const y = relY(e.clientY);
          if (ptr.mode === "create") setPtr({ ...ptr, curY: y });
          else if (ptr.mode === "move")
            setPtr({ ...ptr, curY: y, moved: ptr.moved || Math.abs(y - (ptr.curY ?? y)) > 2 });
          else setPtr({ ...ptr, curY: y });
        }}
        onMouseUp={() => {
          if (!ptr) return;
          if (ptr.mode === "create") {
            const a = Math.min(ptr.startY, ptr.curY);
            const b = Math.max(ptr.startY, ptr.curY);
            let sm = snap(yToMin(a));
            let em = snap(yToMin(b));
            if (em - sm < 30) em = sm + 30;
            sm = clamp(sm, 0, 24 * 60 - 30);
            em = clamp(em, sm + 30, 24 * 60);
            const startMillis = dateAt(sm);
            const endMillis = em >= 1440 ? (() => { const d = new Date(day); d.setDate(d.getDate() + 1); d.setHours(0, 0, 0, 0); return d; })() : dateAt(em);
            onCreate(startMillis, endMillis);
          } else if (ptr.mode === "move") {
            const newStart = clamp(snap(yToMin(ptr.curY) - ptr.grabOffsetMin), 0, 1440 - ptr.durMin);
            if (ptr.moved) onMoveEvent(ptr.ev, dateAt(newStart), dateAt(newStart + ptr.durMin));
            else onEventClick(ptr.ev);
          } else if (ptr.mode === "resize") {
            let em = snap(yToMin(ptr.curY));
            if (em < ptr.origStartMin + 15) em = ptr.origStartMin + 15;
            onResizeEvent(ptr.ev, dateAt(em));
          }
          setPtr(null);
        }}
        onMouseLeave={onMouseUp}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
        }}
        onDrop={(e) => {
          e.preventDefault();
          const raw = e.dataTransfer.getData("application/cadence-task");
          if (!raw) return;
          try {
            const p = JSON.parse(raw) as TaskDropPayload;
            const sm = snap(yToMin(relY(e.clientY)));
            // Fill the block with the task's own estimate (snapped to 15min,
            // minimum 15) instead of always dropping a flat 60min block —
            // a 2hr task dragged at 11am should land at 11am-1pm, not 11-12.
            const estimate = p.estimate_minutes;
            const durMin = estimate && estimate > 0 ? Math.max(15, snap(estimate)) : 60;
            const em = Math.min(sm + durMin, 24 * 60);
            onDropTask(p, dateAt(sm), dateAt(em));
          } catch {
            /* ignore */
          }
        }}
      >
        {HOURS.map((h) => (
          <div
            key={h}
            className="pointer-events-none absolute left-0 right-0 border-t border-border/50"
            style={{ top: h * HOUR_H }}
          />
        ))}
      </div>

      {isSameDay(day, now) && (
        <div className="pointer-events-none absolute left-0 right-0 z-20" style={{ top: (minutesOfDay(now) / 60) * HOUR_H }}>
          <div className="absolute -left-1 -top-[3px] h-1.5 w-1.5 rounded-full bg-danger" />
          <div className="h-px w-full bg-danger" />
        </div>
      )}

      {positioned.map((p) => {
        let s = p.s;
        let en = p.en;
        if (ptr && ptr.mode === "move" && ptr.ev.id === p.ev.id) {
          s = clamp(snap(yToMin(ptr.curY) - ptr.grabOffsetMin), 0, 1440 - ptr.durMin);
          en = s + ptr.durMin;
        } else if (ptr && ptr.mode === "resize" && ptr.ev.id === p.ev.id) {
          en = Math.max(ptr.origStartMin + 15, snap(yToMin(ptr.curY)));
        }
        const top = (s / 60) * HOUR_H;
        const height = Math.max(18, ((en - s) / 60) * HOUR_H);
        const ev = p.ev;
        const isTask = ev.source === "task";
        return (
          <div
            key={ev.id}
            className={clsx(
              "absolute z-10 select-none overflow-hidden rounded-md border-l-2 text-left",
              isTask && "border border-dashed border-l-2",
              isTask && ev.taskDone && "opacity-50"
            )}
            style={{
              top,
              height,
              left: `calc(${p.left * 100}% + 2px)`,
              width: `calc(${p.width * 100}% - 4px)`,
              backgroundColor: isTask
                ? "rgba(124,108,240,0.14)"
                : ev.color
                  ? `${ev.color}33`
                  : "rgba(124,108,240,0.25)",
              borderLeftColor: ev.color ?? "#7C6CF0",
              borderColor: isTask ? "rgba(124,108,240,0.55)" : undefined,
              borderLeftStyle: "solid",
            }}
            onMouseDown={(e) => {
              e.stopPropagation();
              const y = relY(e.clientY);
              setPtr({
                mode: "move",
                curY: y,
                ev,
                grabOffsetMin: yToMin(y) - p.s,
                durMin: p.en - p.s,
                moved: false,
              });
            }}
            onMouseMove={(e) => {
              if (!ptr) return;
              const y = relY(e.clientY);
              if (ptr.mode === "move") setPtr({ ...ptr, curY: y, moved: true });
              else if (ptr.mode === "resize") setPtr({ ...ptr, curY: y });
            }}
            onMouseUp={(e) => {
              if (!ptr) return;
              e.stopPropagation();
              if (ptr.mode === "move") {
                const newStart = clamp(snap(yToMin(ptr.curY) - ptr.grabOffsetMin), 0, 1440 - ptr.durMin);
                if (ptr.moved) onMoveEvent(ptr.ev, dateAt(newStart), dateAt(newStart + ptr.durMin));
                else onEventClick(ptr.ev);
              } else if (ptr.mode === "resize") {
                let em = snap(yToMin(ptr.curY));
                if (em < ptr.origStartMin + 15) em = ptr.origStartMin + 15;
                onResizeEvent(ptr.ev, dateAt(em));
              }
              setPtr(null);
            }}
          >
            <div className="cursor-grab px-2 py-1">
              <div className="flex items-center gap-1">
                {isTask && (
                  <CheckSquare
                    className={clsx(
                      "h-3 w-3 shrink-0",
                      ev.taskDone ? "text-success" : "text-accent"
                    )}
                  />
                )}
                <span
                  className={clsx(
                    "truncate text-xs font-semibold text-txt",
                    isTask && ev.taskDone && "line-through"
                  )}
                >
                  {ev.title}
                </span>
              </div>
              <div className="text-[10px] text-txt3">{fmtTime(new Date(ev.start))}</div>
            </div>
            <div
              className="absolute inset-x-0 bottom-0 h-2 cursor-ns-resize"
              onMouseDown={(e) => {
                e.stopPropagation();
                const y = relY(e.clientY);
                setPtr({ mode: "resize", curY: y, ev, origStartMin: p.s });
              }}
            />
          </div>
        );
      })}

      {ptr && ptr.mode === "create" && Math.abs(ptr.curY - ptr.startY) > 4 && (
        <div
          className="pointer-events-none absolute left-1 right-1 z-10 rounded-md bg-accent/35"
          style={{ top: Math.min(ptr.startY, ptr.curY), height: Math.abs(ptr.curY - ptr.startY) }}
        />
      )}
    </div>
  );
}
