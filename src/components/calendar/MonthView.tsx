"use client";

import { format, isSameDay, isSameMonth } from "date-fns";
import { monthGridDays, minutesOfDay } from "@/lib/dates";
import type { CalendarEvent } from "@/lib/types";
import clsx from "clsx";

export default function MonthView({
  date,
  events,
  onPickDay,
  onEventClick,
}: {
  date: Date;
  events: CalendarEvent[];
  onPickDay: (d: Date) => void;
  onEventClick: (e: CalendarEvent) => void;
}) {
  const days = monthGridDays(date);
  const today = new Date();
  const MAX = 3;
  const byDay = new Map<string, CalendarEvent[]>();
  for (const ev of events) {
    if (ev.allDay) continue;
    const key = format(new Date(ev.start), "yyyy-MM-dd");
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key)!.push(ev);
  }

  return (
    <div className="flex h-full flex-col p-1.5 md:p-3">
      <div className="grid grid-cols-7">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <div
            key={d}
            className="pb-1.5 text-center text-[10px] font-medium uppercase tracking-wide text-txt3 md:pb-2 md:text-xs"
          >
            <span className="md:hidden">{d[0]}</span>
            <span className="hidden md:inline">{d}</span>
          </div>
        ))}
      </div>
      <div className="grid flex-1 grid-cols-7 grid-rows-6 gap-px overflow-hidden rounded-lg bg-border">
        {days.map((day) => {
          const inMonth = isSameMonth(day, date);
          const isToday = isSameDay(day, today);
          const dayEvents = (byDay.get(format(day, "yyyy-MM-dd")) ?? []).sort(
            (a, b) => minutesOfDay(new Date(a.start)) - minutesOfDay(new Date(b.start))
          );
          return (
            <div
              key={day.toISOString()}
              className={clsx(
                "flex min-h-0 cursor-pointer flex-col overflow-hidden bg-bg p-0.5 hover:bg-surface md:p-1.5",
                !inMonth && "opacity-40"
              )}
              onClick={() => onPickDay(day)}
            >
              <div className="mb-0.5 flex justify-center md:mb-1 md:justify-end">
                <span
                  className={clsx(
                    "flex h-5 w-5 items-center justify-center rounded-full text-[11px] md:h-6 md:w-6 md:text-xs",
                    isToday ? "bg-accent font-semibold text-white" : "text-txt2"
                  )}
                >
                  {format(day, "d")}
                </span>
              </div>
              <div className="flex flex-col gap-[2px] overflow-hidden">
                {dayEvents.slice(0, MAX).map((ev) => (
                  <button
                    key={ev.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      onEventClick(ev);
                    }}
                    title={ev.title}
                    className="flex items-center gap-1 overflow-hidden rounded-[3px] px-1 py-[1px] text-left hover:brightness-125 md:rounded md:px-1 md:py-0"
                    style={{ backgroundColor: ev.color ? `${ev.color}2e` : "rgba(124,108,240,0.22)" }}
                  >
                    <span
                      className="hidden h-1.5 w-1.5 shrink-0 rounded-full md:block"
                      style={{ background: ev.color ?? "#7C6CF0" }}
                    />
                    <span className="truncate text-[9px] leading-[13px] md:text-[11px] md:leading-normal">
                      {ev.title}
                    </span>
                  </button>
                ))}
                {dayEvents.length > MAX && (
                  <span className="px-0.5 text-[9px] leading-[12px] text-txt3 md:px-1 md:text-[10px]">
                    +{dayEvents.length - MAX}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
