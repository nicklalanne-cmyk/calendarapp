import * as chrono from "chrono-node";
import { DAY_CODES, nextOccurrence, toISODate } from "./recurrence";

export type Repeat = "daily" | "weekdays" | "weekly" | "monthly";
export type DueKind = "day" | "week";

export type ParsedTask = {
  title: string;
  due_date: string | null;
  due_kind: DueKind;
  priority: number;
  repeat: Repeat | null;
  rrule: string | null;
  project: string | null;
  tags: string[] | null;
  estimate_minutes: number | null;
};

const WEEKDAY_WORDS: Record<string, number> = {
  sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3, thursday: 4, thu: 4, thur: 4, thurs: 4,
  friday: 5, fri: 5, saturday: 6, sat: 6,
};
const ORDINAL_WORDS: Record<string, number> = {
  first: 1, "1st": 1, second: 2, "2nd": 2, third: 3, "3rd": 3,
  fourth: 4, "4th": 4, last: -1,
};

function cut(s: string, index: number, length: number) {
  return (s.slice(0, index) + " " + s.slice(index + length)).trim();
}

/** Sunday-start week containing d. */
export function startOfWeek(d: Date): Date {
  const x = new Date(d);
  x.setDate(x.getDate() - x.getDay());
  x.setHours(0, 0, 0, 0);
  return x;
}

/** Extracts an RRULE from natural language. Returns [rrule, remainingText]. */
function extractRecurrence(input: string): [string | null, string] {
  let s = input;

  // "first/second/third/fourth/last <weekday> of the month"
  const nth = s.match(
    /(?:^|\s)(?:every\s+)?(first|1st|second|2nd|third|3rd|fourth|4th|last)\s+(sunday|sun|monday|mon|tuesday|tues|tue|wednesday|wed|thursday|thurs|thur|thu|friday|fri|saturday|sat)\s+of\s+(?:the\s+|each\s+|every\s+)?month(?=\s|$)/i
  );
  if (nth && nth.index !== undefined) {
    const n = ORDINAL_WORDS[nth[1].toLowerCase()];
    const code = DAY_CODES[WEEKDAY_WORDS[nth[2].toLowerCase()]];
    return [`FREQ=MONTHLY;INTERVAL=1;BYDAY=${n}${code}`, cut(s, nth.index, nth[0].length)];
  }

  // "every other <weekday>" / "every 2nd <weekday>"
  const alt = s.match(
    /(?:^|\s)every\s+(?:other|2nd|second)\s+(sunday|sun|monday|mon|tuesday|tues|tue|wednesday|wed|thursday|thurs|thur|thu|friday|fri|saturday|sat)(?=\s|$)/i
  );
  if (alt && alt.index !== undefined) {
    const code = DAY_CODES[WEEKDAY_WORDS[alt[1].toLowerCase()]];
    return [`FREQ=WEEKLY;INTERVAL=2;BYDAY=${code}`, cut(s, alt.index, alt[0].length)];
  }

  // "every monday and thursday" / "every tuesday"
  const wd = s.match(
    /(?:^|\s)every\s+((?:sunday|sun|monday|mon|tuesday|tues|tue|wednesday|wed|thursday|thurs|thur|thu|friday|fri|saturday|sat)(?:\s*(?:,|and|&)\s*(?:sunday|sun|monday|mon|tuesday|tues|tue|wednesday|wed|thursday|thurs|thur|thu|friday|fri|saturday|sat))*)(?=\s|$)/i
  );
  if (wd && wd.index !== undefined) {
    const codes = wd[1]
      .split(/\s*(?:,|and|&)\s*/i)
      .map((w) => DAY_CODES[WEEKDAY_WORDS[w.trim().toLowerCase()]])
      .filter(Boolean);
    if (codes.length) {
      return [
        `FREQ=WEEKLY;INTERVAL=1;BYDAY=${Array.from(new Set(codes)).join(",")}`,
        cut(s, wd.index, wd[0].length),
      ];
    }
  }

  // "every other week/day/month"
  const otherUnit = s.match(/(?:^|\s)every\s+other\s+(day|week|month|year)(?=\s|$)/i);
  if (otherUnit && otherUnit.index !== undefined) {
    const f = { day: "DAILY", week: "WEEKLY", month: "MONTHLY", year: "YEARLY" }[
      otherUnit[1].toLowerCase()
    ]!;
    return [`FREQ=${f};INTERVAL=2`, cut(s, otherUnit.index, otherUnit[0].length)];
  }

  // "every 3 days/weeks/months"
  const everyN = s.match(/(?:^|\s)every\s+(\d+)\s+(day|days|week|weeks|month|months|year|years)(?=\s|$)/i);
  if (everyN && everyN.index !== undefined) {
    const n = Math.max(1, parseInt(everyN[1], 10));
    const u = everyN[2].toLowerCase().replace(/s$/, "");
    const f = { day: "DAILY", week: "WEEKLY", month: "MONTHLY", year: "YEARLY" }[u]!;
    return [`FREQ=${f};INTERVAL=${n}`, cut(s, everyN.index, everyN[0].length)];
  }

  // "on the 15th of each month" / "every 15th" / "every month on the 15th".
  // "every <N>th" is unambiguous — "every" already signals recurrence. But a
  // bare "on the <N>th" (no "every" and no explicit "of the month") is just
  // an ordinal date — "call mom on the 3rd" means the 3rd of *this* month,
  // once, not "every 3rd of the month forever". Only treat "on the Nth" as
  // recurring when it's paired with an explicit month qualifier.
  const md = s.match(
    /(?:^|\s)(?:every\s+|on\s+the\s+(?=\d{1,2}(?:st|nd|rd|th)\s+of\s+))(\d{1,2})(?:st|nd|rd|th)(?:\s+of\s+(?:the\s+|each\s+|every\s+)?month)?(?=\s|$)/i
  );
  if (md && md.index !== undefined) {
    const day = parseInt(md[1], 10);
    if (day >= 1 && day <= 31) {
      return [`FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=${day}`, cut(s, md.index, md[0].length)];
    }
  }

  // simple keywords
  const simple = s.match(
    /(?:^|\s)(every day|daily|every weekday|weekdays|every week|weekly|every month|monthly|every year|yearly|annually)(?=\s|$)/i
  );
  if (simple && simple.index !== undefined) {
    const k = simple[1].toLowerCase();
    const rule =
      k === "every day" || k === "daily"
        ? "FREQ=DAILY;INTERVAL=1"
        : k === "every weekday" || k === "weekdays"
          ? "FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,TU,WE,TH,FR"
          : k === "every month" || k === "monthly"
            ? "FREQ=MONTHLY;INTERVAL=1"
            : k === "every year" || k === "yearly" || k === "annually"
              ? "FREQ=YEARLY;INTERVAL=1"
              : "FREQ=WEEKLY;INTERVAL=1";
    return [rule, cut(s, simple.index, simple[0].length)];
  }

  return [null, s];
}

/** "review deck #work every other thursday p1 ~90m @design" */
export function parseTaskInput(text: string): ParsedTask {
  let s = text.trim();
  let priority = 0;
  let project: string | null = null;
  const tags: string[] = [];
  let estimate_minutes: number | null = null;
  let due_kind: DueKind = "day";
  let due_date: string | null = null;

  const pm = s.match(/(?:^|\s)(?:p([1-4])|!([1-4]))(?=\s|$)/i);
  if (pm && pm.index !== undefined) {
    priority = parseInt(pm[1] || pm[2], 10);
    s = cut(s, pm.index, pm[0].length);
  }

  const [rrule, afterRepeat] = extractRecurrence(s);
  s = afterRepeat;

  const gm = s.match(/(?:^|\s)#([\w-]+)/);
  if (gm && gm.index !== undefined) {
    project = gm[1];
    s = cut(s, gm.index, gm[0].length);
  }

  const em = s.match(/(?:^|\s)~(\d+(?:\.\d+)?)\s*(m|min|mins|h|hr|hrs)?(?=\s|$)/i);
  if (em && em.index !== undefined) {
    const n = parseFloat(em[1]);
    const unit = (em[2] || "m").toLowerCase();
    estimate_minutes = unit.startsWith("h") ? Math.round(n * 60) : Math.round(n);
    s = cut(s, em.index, em[0].length);
  }

  let tm = s.match(/(?:^|\s)@([\w-]+)/);
  while (tm && tm.index !== undefined) {
    tags.push(tm[1]);
    s = cut(s, tm.index, tm[0].length);
    tm = s.match(/(?:^|\s)@([\w-]+)/);
  }

  // week-level due dates
  const wk = s.match(/(?:^|\s)(this week|next week|the week after next|in (\d+) weeks?)(?=\s|$)/i);
  if (wk && wk.index !== undefined) {
    const k = wk[1].toLowerCase();
    const base = startOfWeek(new Date());
    let add = 0;
    if (k === "next week") add = 1;
    else if (k === "the week after next") add = 2;
    else if (wk[2]) add = Math.max(1, parseInt(wk[2], 10));
    base.setDate(base.getDate() + add * 7);
    due_date = toISODate(base);
    due_kind = "week";
    s = cut(s, wk.index, wk[0].length);
  }

  if (!due_date) {
    const results = chrono.parse(s, new Date(), { forwardDate: true });
    if (results.length) {
      const r = results[0];
      due_date = toISODate(r.start.date());
      s = cut(s, r.index, r.text.length);
    }
  }

  const title = s.replace(/\s+/g, " ").trim();
  return {
    title: title || text.trim(),
    due_date,
    due_kind,
    priority,
    repeat: null,
    rrule,
    project,
    tags: tags.length ? tags : null,
    estimate_minutes,
  };
}

/** Legacy simple repeat -> rrule, so old rows keep working. */
export function legacyToRRule(repeat: string | null): string | null {
  switch (repeat) {
    case "daily": return "FREQ=DAILY;INTERVAL=1";
    case "weekdays": return "FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,TU,WE,TH,FR";
    case "weekly": return "FREQ=WEEKLY;INTERVAL=1";
    case "monthly": return "FREQ=MONTHLY;INTERVAL=1";
    default: return null;
  }
}

/** Next due date for a repeating task (rrule preferred, legacy repeat as fallback). */
export function nextDue(
  task: { rrule?: string | null; repeat?: string | null },
  from: string | null
): string | null {
  const rule = task.rrule || legacyToRRule(task.repeat ?? null);
  if (!rule) return null;
  // If a recurring task sat overdue for a while before being completed, its
  // stored due_date can be well in the past. Searching forward from that
  // stale date would just hand back the *next missed* occurrence — itself
  // already overdue, or several occurrences behind today. Start the search
  // from today instead once we've slipped past the original due date, but
  // keep the original date as the anchor so the weekday/month-day/interval
  // pattern (e.g. "every other Tuesday") isn't reset by the recompute.
  const todayISO = toISODate(new Date());
  const searchFrom = from && from > todayISO ? from : todayISO;
  return nextOccurrence(rule, searchFrom, from ?? searchFrom);
}
