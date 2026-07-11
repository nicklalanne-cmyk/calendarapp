import {
  startOfDay,
  endOfDay,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  addDays,
  format,
} from "date-fns";

export const HOURS = Array.from({ length: 24 }, (_, i) => i);

export function dayRange(d: Date) {
  return { start: startOfDay(d), end: endOfDay(d) };
}

export function weekDays(d: Date) {
  const start = startOfWeek(d, { weekStartsOn: 0 });
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

export function weekRange(d: Date) {
  return {
    start: startOfWeek(d, { weekStartsOn: 0 }),
    end: endOfWeek(d, { weekStartsOn: 0 }),
  };
}

export function minutesOfDay(d: Date) {
  return d.getHours() * 60 + d.getMinutes();
}

export function fmtTime(d: Date) {
  return format(d, "h:mm a");
}

export function fmtDayHeader(d: Date) {
  return format(d, "EEEE, MMM d");
}

export function monthGridStart(d: Date) {
  return startOfWeek(startOfMonth(d), { weekStartsOn: 0 });
}

export function monthGridDays(d: Date) {
  const start = monthGridStart(d);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

export function monthRange(d: Date) {
  const start = monthGridStart(d);
  return { start: startOfDay(start), end: endOfDay(addDays(start, 41)) };
}

export function fmtMonthYear(d: Date) {
  return format(d, "MMMM yyyy");
}
