import type { CalendarEvent } from "@/lib/types";

// Simple module-level cache for /api/google/events responses, keyed by the
// requested time range. Lets Planner/Agenda render instantly from a previous
// fetch instead of blocking every view/date change on a network round-trip,
// while still keeping data reasonably fresh via a TTL + background revalidate.
type CacheEntry = {
  events: CalendarEvent[];
  noAccounts: boolean;
  fetchedAt: number;
};

const cache = new Map<string, CacheEntry>();

export const EVENTS_TTL_MS = 10 * 60 * 1000; // 10 minutes

export function eventsCacheKey(timeMin: string, timeMax: string) {
  return `${timeMin}|${timeMax}`;
}

export function getCachedEvents(key: string): CacheEntry | undefined {
  return cache.get(key);
}

export function isEventsCacheFresh(entry: CacheEntry | undefined): boolean {
  return Boolean(entry) && Date.now() - (entry as CacheEntry).fetchedAt < EVENTS_TTL_MS;
}

export function setCachedEvents(key: string, events: CalendarEvent[], noAccounts: boolean) {
  cache.set(key, { events, noAccounts, fetchedAt: Date.now() });
}

// Invalidate everything — called after a local mutation (create/edit/delete
// event) so the next load doesn't serve stale cached data.
export function clearEventsCache() {
  cache.clear();
}
