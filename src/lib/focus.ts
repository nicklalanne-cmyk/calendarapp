export type Phase = "work" | "short" | "long";

export type PomoState = {
  phase: Phase;
  /** epoch ms when the current phase ends; null when idle/paused */
  endsAt: number | null;
  /** ms left, captured when paused */
  pausedLeft: number | null;
  /** completed work rounds in this cycle */
  round: number;
  taskId: string | null;
  taskTitle: string | null;
  startedAt: number | null;
};

const KEY = "cadence-pomodoro";

export const IDLE: PomoState = {
  phase: "work",
  endsAt: null,
  pausedLeft: null,
  round: 0,
  taskId: null,
  taskTitle: null,
  startedAt: null,
};

/** The timer survives reloads and navigation — it lives in localStorage. */
export function loadState(): PomoState {
  if (typeof window === "undefined") return IDLE;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return IDLE;
    return { ...IDLE, ...(JSON.parse(raw) as PomoState) };
  } catch {
    return IDLE;
  }
}

export function saveState(s: PomoState) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

export function phaseLabel(p: Phase) {
  return p === "work" ? "Focus" : p === "short" ? "Short break" : "Long break";
}

export function fmt(ms: number) {
  const t = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(t / 60);
  const s = t % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** A short chime, synthesised — no audio file to ship or fail to load. */
export function chime(kind: "work" | "break" = "work") {
  try {
    const Ctx =
      (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const notes = kind === "work" ? [880, 1320] : [660, 440];
    notes.forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = f;
      o.connect(g);
      g.connect(ctx.destination);
      const t0 = ctx.currentTime + i * 0.18;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.25, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.34);
      o.start(t0);
      o.stop(t0 + 0.36);
    });
    setTimeout(() => ctx.close().catch(() => {}), 1200);
  } catch {
    /* audio is a nicety, never a failure */
  }
}
