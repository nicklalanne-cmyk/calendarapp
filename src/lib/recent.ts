// Lightweight "recently opened" tracker for quick-find. Deliberately client-only
// (localStorage, not a DB table) — this is a per-device convenience list, not
// data anyone needs synced or backed up. Newest first, capped, deduped by id.

export type RecentKind = "note" | "page" | "task" | "notebook";

export type RecentItem = {
  kind: RecentKind;
  id: string;
  label: string;
  href: string;
  at: number;
};

const KEY = "cadence-recent";
const MAX = 8;

export function getRecents(): RecentItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as RecentItem[]) : [];
  } catch {
    return [];
  }
}

export function recordRecent(item: Omit<RecentItem, "at">) {
  if (typeof window === "undefined") return;
  try {
    const existing = getRecents().filter((r) => !(r.kind === item.kind && r.id === item.id));
    const next = [{ ...item, at: Date.now() }, ...existing].slice(0, MAX);
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage full / disabled — not worth surfacing an error for this */
  }
}
