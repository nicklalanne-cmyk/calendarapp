export const DAY_CODES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const;
export type DayCode = (typeof DAY_CODES)[number];

export type Rule = {
  freq: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
  interval: number;
  byday?: string[]; // "TH" | "1TH" | "-1FR"
  bymonthday?: number;
};

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const ORDINALS: Record<string, string> = { "1": "First", "2": "Second", "3": "Third", "4": "Fourth", "-1": "Last" };

export function toISODate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function fromISODate(s: string): Date {
  const d = new Date(`${s}T00:00:00`);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function formatRRule(r: Rule): string {
  const parts = [`FREQ=${r.freq}`, `INTERVAL=${Math.max(1, r.interval)}`];
  if (r.byday && r.byday.length) parts.push(`BYDAY=${r.byday.join(",")}`);
  if (r.bymonthday) parts.push(`BYMONTHDAY=${r.bymonthday}`);
  return parts.join(";");
}

export function parseRRule(s: string | null | undefined): Rule | null {
  if (!s) return null;
  const clean = s.replace(/^RRULE:/i, "");
  const kv: Record<string, string> = {};
  for (const seg of clean.split(";")) {
    const [k, v] = seg.split("=");
    if (k && v) kv[k.toUpperCase()] = v.toUpperCase();
  }
  const freq = kv.FREQ as Rule["freq"];
  if (!freq || !["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(freq)) return null;
  return {
    freq,
    interval: kv.INTERVAL ? Math.max(1, parseInt(kv.INTERVAL, 10) || 1) : 1,
    byday: kv.BYDAY ? kv.BYDAY.split(",").filter(Boolean) : undefined,
    bymonthday: kv.BYMONTHDAY ? parseInt(kv.BYMONTHDAY, 10) : undefined,
  };
}

function splitByDay(token: string): { n: number | null; code: DayCode } {
  const m = token.match(/^(-?\d+)?([A-Z]{2})$/);
  if (!m) return { n: null, code: "MO" };
  return { n: m[1] ? parseInt(m[1], 10) : null, code: m[2] as DayCode };
}

function diffDays(a: Date, b: Date) {
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}
function startOfWeek(d: Date) {
  const x = new Date(d);
  x.setDate(x.getDate() - x.getDay());
  x.setHours(0, 0, 0, 0);
  return x;
}
function diffMonths(a: Date, b: Date) {
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
}

/** Is `d` the nth (or last) occurrence of its weekday within its month? */
function nthWeekdayMatches(d: Date, n: number): boolean {
  if (n > 0) return Math.floor((d.getDate() - 1) / 7) + 1 === n;
  // negative = from the end
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  const fromEnd = Math.floor((last - d.getDate()) / 7) + 1;
  return fromEnd === -n;
}

function matches(rule: Rule, d: Date, anchor: Date): boolean {
  const code = DAY_CODES[d.getDay()];
  switch (rule.freq) {
    case "DAILY":
      return diffDays(anchor, d) % rule.interval === 0;
    case "WEEKLY": {
      const days = rule.byday?.length ? rule.byday : [DAY_CODES[anchor.getDay()]];
      if (!days.includes(code)) return false;
      const weeks = Math.round(diffDays(startOfWeek(anchor), startOfWeek(d)) / 7);
      return weeks % rule.interval === 0;
    }
    case "MONTHLY": {
      if (diffMonths(anchor, d) % rule.interval !== 0) return false;
      if (rule.bymonthday) return d.getDate() === rule.bymonthday;
      const spec = rule.byday?.[0];
      if (!spec) return d.getDate() === anchor.getDate();
      const { n, code: c } = splitByDay(spec);
      if (c !== code) return false;
      return n == null ? true : nthWeekdayMatches(d, n);
    }
    case "YEARLY":
      return (
        d.getMonth() === anchor.getMonth() &&
        d.getDate() === anchor.getDate() &&
        (d.getFullYear() - anchor.getFullYear()) % rule.interval === 0
      );
  }
}

/** Next date strictly after `from` that satisfies the rule. Returns YYYY-MM-DD. */
export function nextOccurrence(
  rrule: string,
  from: string | null,
  anchorISO?: string | null
): string | null {
  const rule = parseRRule(rrule);
  if (!rule) return null;
  const base = from ? fromISODate(from) : new Date();
  base.setHours(0, 0, 0, 0);
  const anchor = anchorISO ? fromISODate(anchorISO) : base;
  const d = new Date(base);
  for (let i = 0; i < 800; i++) {
    d.setDate(d.getDate() + 1);
    if (matches(rule, d, anchor)) return toISODate(d);
  }
  return null;
}

export function describeRRule(s: string | null | undefined): string {
  const r = parseRRule(s);
  if (!r) return "Never";
  const every = r.interval === 1 ? "Every" : r.interval === 2 ? "Every other" : `Every ${r.interval}`;
  if (r.freq === "DAILY") return r.interval === 1 ? "Every day" : `${every} days`.replace("Every other days", "Every other day");
  if (r.freq === "WEEKLY") {
    const days = r.byday ?? [];
    if (days.length === 5 && ["MO", "TU", "WE", "TH", "FR"].every((x) => days.includes(x)))
      return "Every weekday";
    const names = days.map((x) => DAY_NAMES[DAY_CODES.indexOf(splitByDay(x).code)]).join(", ");
    return names ? `${every} ${names}` : `${every} week`;
  }
  if (r.freq === "MONTHLY") {
    if (r.bymonthday) return `Monthly on day ${r.bymonthday}`;
    const spec = r.byday?.[0];
    if (spec) {
      const { n, code } = splitByDay(spec);
      const ord = n != null ? ORDINALS[String(n)] ?? `${n}th` : "";
      return `${ord} ${DAY_NAMES[DAY_CODES.indexOf(code)]} of the month`.trim();
    }
    return `${every} month`;
  }
  return `${every} year`;
}

/** Common presets derived from a due date. */
export function presetsFor(dueISO: string | null): { label: string; rrule: string }[] {
  const d = dueISO ? fromISODate(dueISO) : new Date();
  const code = DAY_CODES[d.getDay()];
  const name = DAY_NAMES[d.getDay()];
  const nth = Math.floor((d.getDate() - 1) / 7) + 1;
  const ord = ORDINALS[String(nth)] ?? `${nth}th`;
  return [
    { label: "Every day", rrule: "FREQ=DAILY;INTERVAL=1" },
    { label: "Every weekday (Mon–Fri)", rrule: "FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,TU,WE,TH,FR" },
    { label: `Every ${name}`, rrule: `FREQ=WEEKLY;INTERVAL=1;BYDAY=${code}` },
    { label: `Every other ${name}`, rrule: `FREQ=WEEKLY;INTERVAL=2;BYDAY=${code}` },
    { label: `Monthly on day ${d.getDate()}`, rrule: `FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=${d.getDate()}` },
    { label: `${ord} ${name} of the month`, rrule: `FREQ=MONTHLY;INTERVAL=1;BYDAY=${nth}${code}` },
    { label: `Last ${name} of the month`, rrule: `FREQ=MONTHLY;INTERVAL=1;BYDAY=-1${code}` },
    { label: "Every year", rrule: "FREQ=YEARLY;INTERVAL=1" },
  ];
}
