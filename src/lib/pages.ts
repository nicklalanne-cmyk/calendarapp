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

export type PageRecord = {
  id: string;
  page_id: string;
  title: string;
  props: Record<string, unknown>;
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
  sampleTitles?: string[];
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
    name: "CRM / Pipeline",
    description: "Leads, deal value, last contacted, company, email.",
    icon: "🤝",
    view: "table",
    groupBy: "Status",
    properties: [
      { name: "Status", type: "select", choices: ["Leads", "Qualified", "Under contract", "Closed", "Lost"] },
      { name: "Value", type: "currency" },
      { name: "Last contacted", type: "date" },
      { name: "Priority", type: "checkbox" },
      { name: "Company", type: "text" },
      { name: "Email", type: "email" },
      { name: "Phone", type: "phone" },
    ],
  },
  {
    id: "tasks",
    name: "Task list",
    description: "Done, due date, priority, notes.",
    icon: "✅",
    view: "table",
    groupBy: "Stage",
    properties: [
      { name: "Stage", type: "select", choices: ["To do", "In progress", "Done"] },
      { name: "Done", type: "checkbox" },
      { name: "Due", type: "date" },
      { name: "Priority", type: "select", choices: ["High", "Medium", "Low"] },
      { name: "Notes", type: "text" },
    ],
  },
  {
    id: "listings",
    name: "Listings",
    description: "Address, price, status, list date, seller.",
    icon: "🏡",
    view: "board",
    groupBy: "Status",
    properties: [
      { name: "Status", type: "select", choices: ["Prospect", "Coming soon", "Active", "Pending", "Sold"] },
      { name: "Price", type: "currency" },
      { name: "List date", type: "date" },
      { name: "Seller", type: "text" },
      { name: "Phone", type: "phone" },
    ],
  },
];
