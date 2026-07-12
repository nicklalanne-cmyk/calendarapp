export type PropType =
  | "text"
  | "number"
  | "currency"
  | "date"
  | "checkbox"
  | "select"
  | "email"
  | "phone"
  | "url";

export type Choice = { id: string; label: string; color: string };

export type PageProperty = {
  id: string;
  page_id: string;
  name: string;
  type: PropType;
  options: { choices?: Choice[] };
  position: number;
};

/** What a date cell has been turned into / linked to. */
export type CellLink =
  | { kind: "task"; id: string; title: string }
  | {
      kind: "event";
      id: string;
      calendarId: string;
      accountId: string;
      title: string;
      start: string;
    };

export type PageRecord = {
  id: string;
  page_id: string;
  title: string;
  props: Record<string, unknown>;
  /** keyed by property id — a record can link each of its dates separately */
  links: Record<string, CellLink>;
  position: number;
  created_at: string;
};

export type PageView = "table" | "board" | "list" | "calendar";

export type Page = {
  id: string;
  title: string;
  icon: string | null;
  description: string | null;
  view: PageView;
  group_by: string | null;
  date_prop: string | null;
  sort_by: string | null;
  sort_dir: "asc" | "desc";
  position: number;
  pinned_at: string | null;
};

export const PROP_TYPES: { type: PropType; label: string }[] = [
  { type: "text", label: "Text" },
  { type: "number", label: "Number" },
  { type: "currency", label: "Currency" },
  { type: "date", label: "Date" },
  { type: "checkbox", label: "Checkbox" },
  { type: "select", label: "Select" },
  { type: "email", label: "Email" },
  { type: "phone", label: "Phone" },
  { type: "url", label: "URL" },
];

export const CHOICE_COLORS = [
  "#7C6CF0", // violet
  "#4FD1A5", // green
  "#F0A24F", // amber
  "#56A8F0", // blue
  "#F06C7C", // red
  "#9A8CF5", // lilac
  "#6E6E7A", // grey
];

export function uid() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
}

export function formatValue(v: unknown, p: PageProperty): string {
  if (v === null || v === undefined || v === "") return "";
  switch (p.type) {
    case "currency": {
      const n = Number(v);
      if (isNaN(n)) return "";
      return n.toLocaleString(undefined, {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 2,
      });
    }
    case "number": {
      const n = Number(v);
      return isNaN(n) ? "" : n.toLocaleString();
    }
    case "date": {
      const d = new Date(`${String(v)}T00:00:00`);
      if (isNaN(d.getTime())) return String(v);
      return d.toLocaleDateString(undefined, {
        month: "long",
        day: "numeric",
        year: "numeric",
      });
    }
    default:
      return String(v);
  }
}

export function choiceOf(p: PageProperty, v: unknown): Choice | null {
  if (!v) return null;
  return (p.options.choices ?? []).find((c) => c.id === v) ?? null;
}

/** Sort comparator for a property. */
export function compareBy(a: PageRecord, b: PageRecord, p: PageProperty | null, dir: "asc" | "desc") {
  let r = 0;
  if (!p) {
    r = a.position - b.position;
  } else {
    const av = a.props[p.id];
    const bv = b.props[p.id];
    if (av == null && bv == null) r = 0;
    else if (av == null) r = 1;
    else if (bv == null) r = -1;
    else if (p.type === "number" || p.type === "currency") r = Number(av) - Number(bv);
    else if (p.type === "checkbox") r = Number(Boolean(av)) - Number(Boolean(bv));
    else r = String(av).localeCompare(String(bv));
  }
  return dir === "desc" ? -r : r;
}

// ---------------------------------------------------------------------------
// New-page templates
// ---------------------------------------------------------------------------

export type Template = {
  id: string;
  name: string;
  description: string;
  icon: string;
  view: PageView;
  properties: { name: string; type: PropType; choices?: string[] }[];
  /** which property (by name) to group by */
  groupBy?: string;
  /** which date property (by name) the calendar view should plot */
  dateProp?: string;
  /** seed rows so the page isn't an empty grid on day one */
  seed?: string[];
};

export const TEMPLATES: Template[] = [
  {
    id: "blank",
    name: "Blank",
    description: "One text column. Build it however you like.",
    icon: "📄",
    view: "table",
    properties: [{ name: "Notes", type: "text" }],
  },
  {
    id: "crm",
    name: "CRM",
    description: "Leads and deals — status, value, last contacted, contact details.",
    icon: "🤝",
    view: "table",
    groupBy: "Status",
    dateProp: "Follow up",
    properties: [
      {
        name: "Status",
        type: "select",
        choices: ["Lead", "Qualified", "Showing", "Under contract", "Closed", "Lost"],
      },
      { name: "Value", type: "currency" },
      { name: "Last contacted", type: "date" },
      { name: "Follow up", type: "date" },
      { name: "Priority", type: "checkbox" },
      { name: "Company", type: "text" },
      { name: "Phone", type: "phone" },
      { name: "Email", type: "email" },
      { name: "Notes", type: "text" },
    ],
  },
  {
    id: "project",
    name: "Project",
    description:
      "A house project. One row per trade or scope — contractor, quote, timeline, follow-ups.",
    icon: "🏗️",
    view: "table",
    groupBy: "Stage",
    dateProp: "Next follow-up",
    properties: [
      {
        name: "Stage",
        type: "select",
        choices: [
          "Scoping",
          "Awaiting quote",
          "Quote received",
          "Approved",
          "In progress",
          "Blocked",
          "Complete",
        ],
      },
      { name: "Contractor", type: "text" },
      { name: "Phone", type: "phone" },
      { name: "Email", type: "email" },
      { name: "Quote", type: "currency" },
      { name: "Actual cost", type: "currency" },
      { name: "Paid", type: "checkbox" },
      { name: "Start", type: "date" },
      { name: "Target finish", type: "date" },
      { name: "Next follow-up", type: "date" },
      { name: "Notes", type: "text" },
    ],
    // A house project has the same trades every time — start with the scaffolding.
    seed: [
      "Demo & haul-away",
      "Permits",
      "Framing",
      "Roofing",
      "Windows & doors",
      "Plumbing",
      "Electrical",
      "HVAC",
      "Insulation & drywall",
      "Cabinets & millwork",
      "Countertops",
      "Flooring",
      "Tile",
      "Paint",
      "Landscaping",
      "Final clean & punch list",
    ],
  },
];


// ---------------------------------------------------------------------------
// Changing a property's type must not silently destroy data.
// ---------------------------------------------------------------------------

const TRUTHY = new Set(["true", "yes", "y", "1", "done", "x", "✓"]);

/**
 * Convert one value from `from` type to `to` type.
 * Returns `undefined` when the value can't be represented (caller drops it).
 */
export function coerceValue(
  v: unknown,
  from: PropType,
  to: PropType,
  target: PageProperty
): unknown {
  if (v === null || v === undefined || v === "") return null;

  // resolve a select id to its human label first — otherwise we'd migrate a uuid
  let raw = v;
  if (from === "select") {
    const c = (target.options.choices ?? []).find((x) => x.id === v);
    raw = c ? c.label : v;
  }
  if (from === "checkbox") raw = v ? "Yes" : "No";

  const str = String(raw).trim();

  switch (to) {
    case "number":
    case "currency": {
      const cleaned = str.replace(/[^0-9.-]/g, "");
      // Number("") is 0 — without this guard, "abc" would silently become $0.
      if (cleaned === "" || cleaned === "-" || cleaned === ".") return null;
      const n = Number(cleaned);
      return isNaN(n) ? null : n;
    }
    case "checkbox":
      return TRUTHY.has(str.toLowerCase()) || (!isNaN(Number(str)) && Number(str) > 0);
    case "date": {
      const d = new Date(str);
      if (isNaN(d.getTime())) return null;
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
        d.getDate()
      ).padStart(2, "0")}`;
    }
    case "select": {
      // match an existing option by label (case-insensitive); the caller creates
      // any missing ones so no value is lost
      const c = (target.options.choices ?? []).find(
        (x) => x.label.toLowerCase() === str.toLowerCase()
      );
      return c ? c.id : null;
    }
    default:
      return str;
  }
}

/**
 * Retype a property across every record. When converting TO a select, any
 * distinct value that has no matching option gets one created for it.
 */
export function retypeProperty(
  prop: PageProperty,
  to: PropType,
  records: PageRecord[]
): { property: PageProperty; changed: { id: string; props: Record<string, unknown> }[] } {
  const next: PageProperty = { ...prop, type: to, options: { ...prop.options } };

  if (to === "select") {
    const choices: Choice[] = [...(prop.options.choices ?? [])];
    const seen = new Set(choices.map((c) => c.label.toLowerCase()));

    for (const r of records) {
      const v = r.props[prop.id];
      if (v === null || v === undefined || v === "") continue;
      let label = String(v).trim();
      if (prop.type === "checkbox") label = v ? "Yes" : "No";
      if (prop.type === "select") continue; // already a select
      if (!label || seen.has(label.toLowerCase())) continue;
      if (choices.length >= 40) break; // don't explode on a free-text column
      seen.add(label.toLowerCase());
      choices.push({
        id: uid(),
        label,
        color: CHOICE_COLORS[choices.length % CHOICE_COLORS.length],
      });
    }
    next.options = { ...next.options, choices };
  }

  const empty = (x: unknown) => x === null || x === undefined || x === "";

  const changed: { id: string; props: Record<string, unknown> }[] = [];
  for (const r of records) {
    const before = r.props[prop.id];
    const after = coerceValue(before, prop.type, to, next);
    const norm = after === undefined ? null : after;
    if (empty(before) && empty(norm)) continue; // nothing to write
    if (norm !== before) {
      changed.push({ id: r.id, props: { ...r.props, [prop.id]: norm } });
    }
  }

  return { property: next, changed };
}
