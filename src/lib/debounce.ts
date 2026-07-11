/**
 * Coalesces rapid calls (typing) into one trailing call.
 * Keyed, so different fields/rows don't cancel each other.
 */
export function makeDebouncer(ms = 500) {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  const run = (key: string, fn: () => void) => {
    const t = timers.get(key);
    if (t) clearTimeout(t);
    timers.set(
      key,
      setTimeout(() => {
        timers.delete(key);
        fn();
      }, ms)
    );
  };

  /** Is a write for this key still queued? Realtime must not overwrite it. */
  const pending = (key: string) => timers.has(key);

  /** Fire anything still pending right now (e.g. on unmount / navigate away). */
  const flushAll = () => {
    for (const [, t] of timers) clearTimeout(t);
    timers.clear();
  };

  return { run, pending, flushAll };
}
