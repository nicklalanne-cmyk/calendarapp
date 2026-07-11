"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Play, Pause, RotateCcw, SkipForward, Coffee, Brain, Settings2, X, Flame, Check,
} from "lucide-react";
import clsx from "clsx";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/lib/toast";
import { useSettings } from "@/components/SettingsProvider";
import type { Task } from "@/lib/types";
import {
  chime, fmt, IDLE, loadState, phaseLabel, saveState, type Phase, type PomoState,
} from "@/lib/focus";

type Session = {
  id: string;
  kind: Phase;
  minutes: number;
  task_title: string | null;
  started_at: string;
  completed: boolean;
};

export default function FocusView() {
  const supabase = createClient();
  const { settings, update } = useSettings();

  const [st, setSt] = useState<PomoState>(IDLE);
  const [now, setNow] = useState(() => Date.now());
  const [tasks, setTasks] = useState<Task[]>([]);
  const [today, setToday] = useState<Session[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const firing = useRef(false);

  const s = settings as unknown as Record<string, number | boolean>;
  const durations: Record<Phase, number> = useMemo(
    () => ({
      work: (s.pomo_work as number) ?? 25,
      short: (s.pomo_short as number) ?? 5,
      long: (s.pomo_long as number) ?? 15,
    }),
    [s]
  );
  const rounds = (s.pomo_rounds as number) ?? 4;
  const autostart = Boolean(s.pomo_autostart);

  useEffect(() => {
    setSt(loadState());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) saveState(st);
  }, [st, hydrated]);

  const loadData = useCallback(async () => {
    const { data: t } = await supabase
      .from("tasks")
      .select("*")
      .eq("is_done", false)
      .is("deleted_at", null)
      .is("parent_id", null)
      .limit(50);
    setTasks((t as Task[]) ?? []);

    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const { data: f } = await supabase
      .from("focus_sessions")
      .select("id,kind,minutes,task_title,started_at,completed")
      .gte("started_at", dayStart.toISOString())
      .order("started_at", { ascending: false });
    setToday((f as Session[]) ?? []);
  }, [supabase]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Ticks off a target timestamp, never a decrementing counter: browsers throttle
  // timers in background tabs, so a countdown would silently drift.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);

  const total = durations[st.phase] * 60_000;
  const left = st.endsAt ? Math.max(0, st.endsAt - now) : (st.pausedLeft ?? total);
  const running = st.endsAt !== null;
  const progress = total > 0 ? 1 - left / total : 0;

  const logSession = useCallback(
    async (state: PomoState, completed: boolean) => {
      if (!state.startedAt) return;
      const mins = Math.max(1, Math.round((Date.now() - state.startedAt) / 60000));
      await supabase.from("focus_sessions").insert({
        task_id: state.taskId,
        task_title: state.taskTitle,
        kind: state.phase,
        minutes: mins,
        started_at: new Date(state.startedAt).toISOString(),
        ended_at: new Date().toISOString(),
        completed,
      });
      loadData();
    },
    [supabase, loadData]
  );

  const notify = (title: string, body: string) => {
    try {
      if (typeof Notification !== "undefined" && Notification.permission === "granted") {
        new Notification(title, { body, icon: "/icon-192.png" });
      }
    } catch {
      /* ignore */
    }
  };

  const advance = useCallback(
    (auto: boolean) => {
      const wasWork = st.phase === "work";
      const nextRound = wasWork ? st.round + 1 : st.round;
      const nextPhase: Phase = wasWork
        ? nextRound % rounds === 0
          ? "long"
          : "short"
        : "work";
      const go = auto && autostart;
      setSt({
        ...st,
        phase: nextPhase,
        round: nextRound,
        endsAt: go ? Date.now() + durations[nextPhase] * 60_000 : null,
        pausedLeft: null,
        startedAt: go ? Date.now() : null,
      });
    },
    [st, rounds, durations, autostart]
  );

  useEffect(() => {
    if (!running || left > 0 || firing.current) return;
    firing.current = true;

    const wasWork = st.phase === "work";
    chime(wasWork ? "work" : "break");
    notify(
      wasWork ? "Focus session done" : "Break over",
      wasWork
        ? st.taskTitle
          ? `Nice work on “${st.taskTitle}”. Take a break.`
          : "Take a break."
        : "Back to it."
    );
    logSession(st, true);
    advance(true);
    setTimeout(() => {
      firing.current = false;
    }, 800);
  }, [running, left, st, advance, logSession]);

  useEffect(() => {
    if (!running) {
      document.title = "Cadence — daily planner";
      return;
    }
    document.title = `${fmt(left)} · ${phaseLabel(st.phase)}`;
    return () => {
      document.title = "Cadence — daily planner";
    };
  }, [running, left, st.phase]);

  const start = async () => {
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      try {
        await Notification.requestPermission();
      } catch {
        /* ignore */
      }
    }
    const ms = st.pausedLeft ?? durations[st.phase] * 60_000;
    setSt({
      ...st,
      endsAt: Date.now() + ms,
      pausedLeft: null,
      startedAt: st.startedAt ?? Date.now(),
    });
  };

  const pause = () => setSt({ ...st, endsAt: null, pausedLeft: left });

  const reset = () => {
    if (running && st.phase === "work" && st.startedAt) logSession(st, false);
    setSt({ ...st, endsAt: null, pausedLeft: null, startedAt: null });
  };

  const skip = () => {
    if (running && st.startedAt) logSession(st, false);
    advance(false);
  };

  const pickTask = (t: Task | null) =>
    setSt({ ...st, taskId: t?.id ?? null, taskTitle: t?.title ?? null });

  const completeTask = async () => {
    if (!st.taskId) return;
    const { error } = await supabase.from("tasks").update({ is_done: true }).eq("id", st.taskId);
    if (error) return toast(error.message, "error");
    toast(`Completed “${st.taskTitle}”`);
    setSt({ ...st, taskId: null, taskTitle: null });
    window.dispatchEvent(new CustomEvent("cadence:tasks-changed"));
    loadData();
  };

  const doneWork = today.filter((x) => x.kind === "work" && x.completed);
  const focusMins = doneWork.reduce((n, x) => n + x.minutes, 0);

  const R = 130;
  const C = 2 * Math.PI * R;
  const accent =
    st.phase === "work" ? "#7C6CF0" : st.phase === "short" ? "#4FD1A5" : "#56A8F0";

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl px-4 py-6 md:px-8">
        <div className="mb-6 flex items-center gap-3">
          <h1 className="text-2xl font-semibold">Focus</h1>
          <button
            onClick={() => setShowSettings(true)}
            title="Timer settings"
            className="ml-auto flex h-10 w-10 items-center justify-center rounded-xl text-txt3 hover:bg-surface"
          >
            <Settings2 className="h-[18px] w-[18px]" />
          </button>
        </div>

        <div className="mx-auto mb-6 flex w-fit items-center gap-0.5 rounded-xl bg-surface2 p-0.5">
          {(["work", "short", "long"] as Phase[]).map((p) => (
            <button
              key={p}
              onClick={() =>
                setSt({ ...st, phase: p, endsAt: null, pausedLeft: null, startedAt: null })
              }
              className={clsx(
                "flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs transition md:text-sm",
                st.phase === p ? "bg-surface text-txt shadow-sm" : "text-txt3"
              )}
            >
              {p === "work" ? <Brain className="h-3.5 w-3.5" /> : <Coffee className="h-3.5 w-3.5" />}
              {phaseLabel(p)}
            </button>
          ))}
        </div>

        <div className="relative mx-auto mb-6 flex h-[300px] w-[300px] items-center justify-center">
          <svg className="absolute inset-0 -rotate-90" viewBox="0 0 300 300">
            <circle cx="150" cy="150" r={R} fill="none" stroke="rgb(var(--surface-3))" strokeWidth="12" />
            <circle
              cx="150"
              cy="150"
              r={R}
              fill="none"
              stroke={accent}
              strokeWidth="12"
              strokeLinecap="round"
              strokeDasharray={C}
              strokeDashoffset={C * (1 - progress)}
              style={{ transition: "stroke-dashoffset 250ms linear" }}
            />
          </svg>

          <div className="text-center">
            <div className="font-mono text-6xl font-semibold tabular-nums tracking-tight">
              {fmt(left)}
            </div>
            <div className="mt-1 text-xs uppercase tracking-widest text-txt3">
              {phaseLabel(st.phase)}
            </div>
            <div className="mt-3 flex items-center justify-center gap-1.5">
              {Array.from({ length: rounds }, (_, i) => (
                <span
                  key={i}
                  className={clsx(
                    "h-1.5 w-1.5 rounded-full",
                    i < st.round % rounds ? "bg-accent" : "bg-surface3"
                  )}
                />
              ))}
            </div>
          </div>
        </div>

        <div className="mb-6 flex items-center justify-center gap-3">
          <button
            onClick={reset}
            disabled={!running && st.pausedLeft === null && st.startedAt === null}
            title="Reset"
            className="flex h-12 w-12 items-center justify-center rounded-full border border-border text-txt3 transition hover:bg-surface disabled:opacity-30"
          >
            <RotateCcw className="h-5 w-5" />
          </button>
          <button
            onClick={running ? pause : start}
            className="flex h-16 w-16 items-center justify-center rounded-full text-white shadow-lg transition active:scale-95"
            style={{ background: accent }}
          >
            {running ? <Pause className="h-7 w-7" /> : <Play className="ml-0.5 h-7 w-7" />}
          </button>
          <button
            onClick={skip}
            title="Skip to next phase"
            className="flex h-12 w-12 items-center justify-center rounded-full border border-border text-txt3 transition hover:bg-surface"
          >
            <SkipForward className="h-5 w-5" />
          </button>
        </div>

        <div className="mb-6 rounded-xl border border-border bg-surface p-4">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-txt3">
            Working on
          </p>
          {st.taskId ? (
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-sm">{st.taskTitle}</span>
              <button
                onClick={completeTask}
                className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs text-txt2 hover:bg-surface2 hover:text-success"
              >
                <Check className="h-3.5 w-3.5" /> Done
              </button>
              <button
                onClick={() => pickTask(null)}
                className="rounded-lg p-1.5 text-txt3 hover:bg-surface2"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : tasks.length === 0 ? (
            <p className="text-xs text-txt3">No open tasks.</p>
          ) : (
            <select
              value=""
              onChange={(e) => pickTask(tasks.find((x) => x.id === e.target.value) ?? null)}
              className="w-full rounded-lg border border-border bg-bg px-2.5 py-2 text-sm outline-none focus:border-accent"
            >
              <option value="">Pick a task to focus on…</option>
              {tasks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="rounded-xl border border-border bg-surface p-4">
          <div className="mb-3 flex items-center gap-2">
            <Flame className="h-4 w-4 text-accent" />
            <span className="text-sm font-semibold">Today</span>
            <span className="ml-auto text-xs text-txt3">
              {doneWork.length} session{doneWork.length === 1 ? "" : "s"} ·{" "}
              {focusMins >= 60
                ? `${Math.floor(focusMins / 60)}h ${focusMins % 60}m`
                : `${focusMins}m`}{" "}
              focused
            </span>
          </div>
          {doneWork.length === 0 ? (
            <p className="text-xs text-txt3">Nothing yet — start a session.</p>
          ) : (
            <div className="space-y-1">
              {doneWork.slice(0, 8).map((x) => (
                <div key={x.id} className="flex items-center gap-2 text-xs">
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                  <span className="min-w-0 flex-1 truncate text-txt2">
                    {x.task_title || "Focus"}
                  </span>
                  <span className="shrink-0 tabular-nums text-txt3">{x.minutes}m</span>
                  <span className="shrink-0 text-txt3">
                    {new Date(x.started_at).toLocaleTimeString(undefined, {
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {showSettings && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center md:justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowSettings(false)} />
          <div className="relative w-full rounded-t-2xl border-t border-border bg-surface p-4 pb-8 md:max-w-sm md:rounded-2xl md:border md:pb-4">
            <div className="mb-4 flex items-center">
              <h2 className="text-base font-semibold">Timer</h2>
              <button
                onClick={() => setShowSettings(false)}
                className="ml-auto flex h-9 w-9 items-center justify-center rounded-lg text-txt3"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-3">
              {(
                [
                  ["pomo_work", "Focus (min)", 1, 90],
                  ["pomo_short", "Short break (min)", 1, 30],
                  ["pomo_long", "Long break (min)", 1, 60],
                  ["pomo_rounds", "Rounds before a long break", 1, 8],
                ] as const
              ).map(([key, label, min, max]) => (
                <div key={key} className="flex items-center gap-3">
                  <span className="min-w-0 flex-1 text-sm text-txt2">{label}</span>
                  <input
                    type="number"
                    min={min}
                    max={max}
                    value={(s[key] as number) ?? min}
                    onChange={(e) => {
                      const v = Math.max(min, Math.min(max, Number(e.target.value) || min));
                      update({ [key]: v } as never);
                    }}
                    className="w-20 rounded-lg border border-border bg-bg px-2 py-1.5 text-sm outline-none focus:border-accent"
                  />
                </div>
              ))}

              <label className="flex items-center gap-3 pt-1">
                <input
                  type="checkbox"
                  checked={autostart}
                  onChange={(e) => update({ pomo_autostart: e.target.checked } as never)}
                  className="h-4 w-4"
                />
                <span className="text-sm text-txt2">Start the next phase automatically</span>
              </label>
            </div>

            <p className="mt-4 text-[11px] text-txt3">
              The timer keeps running if you navigate away or reload — it&apos;s pinned to a clock
              time, not a countdown.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
