/** Shared date math for the "Add follow-up" action on tasks/events — kept
 * framework-free so both TaskModal and EventModal (and whatever creates the
 * follow-up task in Planner/AgendaView) can use the exact same rules. */

export function addDays(base: Date, n: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + n);
  return d;
}

export function isWeekend(d: Date): boolean {
  const day = d.getDay();
  return day === 0 || day === 6;
}

/** Walks forward from the day after `base` to the next Mon–Fri date. */
export function nextBusinessDay(base: Date): Date {
  let d = addDays(base, 1);
  while (isWeekend(d)) d = addDays(d, 1);
  return d;
}

export type FollowUpQuickOption = {
  key: string;
  label: string;
  compute: (base: Date) => Date;
};

export const FOLLOW_UP_QUICK_OPTIONS: FollowUpQuickOption[] = [
  { key: "1d", label: "1 day", compute: (b) => addDays(b, 1) },
  { key: "3d", label: "3 days", compute: (b) => addDays(b, 3) },
  { key: "7d", label: "7 days", compute: (b) => addDays(b, 7) },
  { key: "30d", label: "30 days", compute: (b) => addDays(b, 30) },
  { key: "next_biz", label: "Next business day", compute: (b) => nextBusinessDay(b) },
];
