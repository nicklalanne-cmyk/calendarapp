"use client";

import { useEffect, useMemo, useState } from "react";
import { X, Trash2, Repeat } from "lucide-react";
import clsx from "clsx";
import type { Task } from "@/lib/types";
import { describeRRule, presetsFor, parseRRule, formatRRule, DAY_CODES } from "@/lib/recurrence";
import { legacyToRRule, startOfWeek } from "@/lib/tasks";
import { toISODate } from "@/lib/recurrence";

const PRIORITY_COLOR = ["#6E6E7A", "#F06C7C", "#F0A24F", "#56A8F0", "#9A8CF5"];
const DAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];

export type EditScope = "occurrence" | "series";

export type TaskDraft = {
  title: string;
  due_date: string | null;
  due_kind: "day" | "week";
  priority: number;
  rrule: string | null;
  project: string | null;
  tags: string[] | null;
  estimate_minutes: number | null;
  notes: string | null;
  /** For repeating tasks: change just this one, or the whole series. */
  scope?: EditScope;
};

const field =
  "w-full rounded-lg border border-border bg-bg px-3 py-2.5 text-[15px] outline-none focus:border-accent md:px-2.5 md:py-1.5 md:text-sm";
const label = "mb-1 block text-[11px] font-semibold uppercase tracking-wide text-txt3";

export default function TaskModal({
  task,
  mode,
  projects,
  onClose,
  onSave,
  onDelete,
}: {
  task: Task | null;
  mode: "create" | "edit";
  projects: string[];
  onClose: () => void;
  onSave: (draft: TaskDraft) => void;
  onDelete?: (t: Task) => void;
}) {
  const [title, setTitle] = useState(task?.title ?? "");
  const [dueKind, setDueKind] = useState<"day" | "week">(task?.due_kind ?? "day");
  const [due, setDue] = useState(task?.due_date ?? "");
  const [priority, setPriority] = useState(task?.priority ?? 0);
  const [rrule, setRRule] = useState<string | null>(
    task?.rrule ?? legacyToRRule(task?.repeat ?? null)
  );
  const [custom, setCustom] = useState(false);
  const [project, setProject] = useState(task?.project ?? "");
  const [estimate, setEstimate] = useState(
    task?.estimate_minutes ? String(task.estimate_minutes) : ""
  );
  const [tags, setTags] = useState((task?.tags ?? []).join(", "));
  const [notes, setNotes] = useState(task?.notes ?? "");
  const repeats = Boolean(task?.rrule || task?.repeat);
  const [scope, setScope] = useState<EditScope>("series");

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);

  const presets = useMemo(() => presetsFor(due || null), [due]);
  const rule = useMemo(() => parseRRule(rrule), [rrule]);
  const isPreset = !rrule || presets.some((p) => p.rrule === rrule);

  // when switching to "week", snap the date to the start of its week
  const setKind = (k: "day" | "week") => {
    setDueKind(k);
    if (k === "week" && due) setDue(toISODate(startOfWeek(new Date(`${due}T00:00:00`))));
  };

  const patchRule = (patch: Partial<NonNullable<typeof rule>>) => {
    const base = rule ?? { freq: "WEEKLY" as const, interval: 1 };
    setRRule(formatRRule({ ...base, ...patch }));
  };

  const toggleDay = (code: string) => {
    const cur = rule?.byday ?? [];
    const next = cur.includes(code) ? cur.filter((c) => c !== code) : [...cur, code];
    patchRule({ byday: next.length ? next : undefined });
  };

  const submit = () => {
    if (!title.trim()) return;
    onSave({
      title: title.trim(),
      due_date: due || null,
      due_kind: dueKind,
      priority,
      // detaching a single occurrence: it keeps the edit but stops repeating
      rrule: mode === "edit" && repeats && scope === "occurrence" ? null : rrule,
      project: project.trim() || null,
      tags: tags.trim() ? tags.split(",").map((t) => t.trim()).filter(Boolean) : null,
      estimate_minutes: estimate ? parseInt(estimate, 10) || null : null,
      notes: notes.trim() || null,
      scope: mode === "edit" && repeats ? scope : undefined,
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 pt-[6vh]"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-lg rounded-xl border border-border bg-surface shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">{mode === "create" ? "New task" : "Edit task"}</h2>
          <button onClick={onClose} className="rounded p-1 text-txt3 hover:bg-surface2 hover:text-txt">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3 p-4">
          <div>
            <label className={label}>Task</label>
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && e.metaKey && submit()}
              placeholder="What needs doing?"
              className={field}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className={`${label} mb-0`}>Due</span>
                <div className="flex rounded-md border border-border p-0.5">
                  {(["day", "week"] as const).map((k) => (
                    <button
                      key={k}
                      onClick={() => setKind(k)}
                      className={clsx(
                        "rounded px-1.5 py-0.5 text-[10px] capitalize",
                        dueKind === k ? "bg-accent text-white" : "text-txt3 hover:text-txt"
                      )}
                    >
                      {k}
                    </button>
                  ))}
                </div>
              </div>
              <input
                type="date"
                value={due}
                onChange={(e) => {
                  const v = e.target.value;
                  if (!v) return setDue("");
                  // a "week" due date is always stored as the SUNDAY that starts the week
                  setDue(
                    dueKind === "week"
                      ? toISODate(startOfWeek(new Date(`${v}T00:00:00`)))
                      : v
                  );
                }}
                className={field}
              />
              {dueKind === "week" && due && (
                <p className="mt-1 text-[11px] text-accentSoft">
                  Week of {weekLabel(due)} · due any time that week
                </p>
              )}
              {dueKind === "week" && !due && (
                <p className="mt-1 text-[11px] text-txt3">
                  Pick any day — it snaps to that Sun–Sat week.
                </p>
              )}
            </div>

            <div>
              <label className={label}>Estimate (min)</label>
              <input
                type="number"
                min={0}
                step={5}
                value={estimate}
                onChange={(e) => setEstimate(e.target.value)}
                placeholder="90"
                className={field}
              />
            </div>
          </div>

          <div>
            <label className={label}>Priority</label>
            <div className="flex gap-1">
              {[0, 1, 2, 3, 4].map((p) => (
                <button
                  key={p}
                  onClick={() => setPriority(p)}
                  className={clsx(
                    "flex-1 rounded-md border px-2 py-2 text-[13px] transition md:py-1 md:text-xs",
                    priority === p ? "border-transparent text-white" : "border-border text-txt3 hover:text-txt"
                  )}
                  style={priority === p ? { background: PRIORITY_COLOR[p] } : undefined}
                >
                  {p === 0 ? "None" : `P${p}`}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className={label}>Repeat</label>
            <select
              value={custom ? "__custom" : rrule ?? ""}
              onChange={(e) => {
                const v = e.target.value;
                if (v === "__custom") {
                  setCustom(true);
                  if (!rrule) setRRule("FREQ=WEEKLY;INTERVAL=1");
                } else {
                  setCustom(false);
                  setRRule(v || null);
                }
              }}
              className={field}
            >
              <option value="">Never</option>
              {presets.map((p) => (
                <option key={p.rrule} value={p.rrule}>
                  {p.label}
                </option>
              ))}
              {!isPreset && rrule && !custom && (
                <option value={rrule}>{describeRRule(rrule)}</option>
              )}
              <option value="__custom">Custom…</option>
            </select>

            {custom && rule && (
              <div className="mt-2 space-y-2 rounded-lg border border-border bg-bg p-2.5">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-txt3">Every</span>
                  <input
                    type="number"
                    min={1}
                    value={rule.interval}
                    onChange={(e) => patchRule({ interval: Math.max(1, +e.target.value || 1) })}
                    className="w-16 rounded border border-border bg-surface px-2 py-1 text-sm outline-none focus:border-accent"
                  />
                  <select
                    value={rule.freq}
                    onChange={(e) =>
                      patchRule({ freq: e.target.value as typeof rule.freq, byday: undefined, bymonthday: undefined })
                    }
                    className="flex-1 rounded border border-border bg-surface px-2 py-1 text-sm outline-none focus:border-accent"
                  >
                    <option value="DAILY">day(s)</option>
                    <option value="WEEKLY">week(s)</option>
                    <option value="MONTHLY">month(s)</option>
                    <option value="YEARLY">year(s)</option>
                  </select>
                </div>

                {rule.freq === "WEEKLY" && (
                  <div className="flex gap-1">
                    {DAY_CODES.map((c, i) => (
                      <button
                        key={c}
                        onClick={() => toggleDay(c)}
                        className={clsx(
                          "h-7 w-7 rounded-full text-[11px] transition",
                          (rule.byday ?? []).includes(c)
                            ? "bg-accent text-white"
                            : "border border-border text-txt3 hover:text-txt"
                        )}
                      >
                        {DAY_LABELS[i]}
                      </button>
                    ))}
                  </div>
                )}

                {rule.freq === "MONTHLY" && (
                  <div className="space-y-1.5">
                    <label className="flex items-center gap-2 text-xs text-txt2">
                      <input
                        type="radio"
                        checked={!rule.byday}
                        onChange={() =>
                          patchRule({
                            byday: undefined,
                            bymonthday: due ? new Date(`${due}T00:00:00`).getDate() : 1,
                          })
                        }
                      />
                      On day
                      <input
                        type="number"
                        min={1}
                        max={31}
                        value={rule.bymonthday ?? 1}
                        onChange={(e) =>
                          patchRule({ bymonthday: Math.min(31, Math.max(1, +e.target.value || 1)), byday: undefined })
                        }
                        className="w-16 rounded border border-border bg-surface px-2 py-0.5 text-sm outline-none focus:border-accent"
                      />
                    </label>
                    <label className="flex items-center gap-2 text-xs text-txt2">
                      <input
                        type="radio"
                        checked={Boolean(rule.byday)}
                        onChange={() => {
                          const d = due ? new Date(`${due}T00:00:00`) : new Date();
                          const nth = Math.floor((d.getDate() - 1) / 7) + 1;
                          patchRule({ byday: [`${nth}${DAY_CODES[d.getDay()]}`], bymonthday: undefined });
                        }}
                      />
                      On the
                      <select
                        value={(rule.byday?.[0] ?? "").match(/^-?\d+/)?.[0] ?? "1"}
                        onChange={(e) => {
                          const code = (rule.byday?.[0] ?? "1MO").replace(/^-?\d+/, "");
                          patchRule({ byday: [`${e.target.value}${code}`], bymonthday: undefined });
                        }}
                        disabled={!rule.byday}
                        className="rounded border border-border bg-surface px-1.5 py-0.5 text-sm outline-none focus:border-accent"
                      >
                        <option value="1">first</option>
                        <option value="2">second</option>
                        <option value="3">third</option>
                        <option value="4">fourth</option>
                        <option value="-1">last</option>
                      </select>
                      <select
                        value={(rule.byday?.[0] ?? "1MO").replace(/^-?\d+/, "")}
                        onChange={(e) => {
                          const n = (rule.byday?.[0] ?? "1MO").match(/^-?\d+/)?.[0] ?? "1";
                          patchRule({ byday: [`${n}${e.target.value}`], bymonthday: undefined });
                        }}
                        disabled={!rule.byday}
                        className="rounded border border-border bg-surface px-1.5 py-0.5 text-sm outline-none focus:border-accent"
                      >
                        {DAY_CODES.map((c, i) => (
                          <option key={c} value={c}>
                            {["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][i]}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                )}
              </div>
            )}

            {rrule && (
              <p className="mt-1 text-[11px] text-accentSoft">Repeats: {describeRRule(rrule)}</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label}>Project</label>
              <input
                list="cadence-projects"
                value={project}
                onChange={(e) => setProject(e.target.value)}
                placeholder="work"
                className={field}
              />
              <datalist id="cadence-projects">
                {projects.map((p) => (
                  <option key={p} value={p} />
                ))}
              </datalist>
            </div>
            <div>
              <label className={label}>Tags (comma-separated)</label>
              <input
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="design, urgent"
                className={field}
              />
            </div>
          </div>

          <div>
            <label className={label}>Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Details…"
              className={`${field} resize-y`}
            />
          </div>
        </div>

        {mode === "edit" && repeats && (
          <div className="border-t border-border bg-bg/50 px-4 py-3">
            <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-txt3">
              <Repeat className="h-3.5 w-3.5" /> This task repeats — apply changes to
            </p>
            <div className="flex gap-2">
              {(
                [
                  ["occurrence", "Just this one"],
                  ["series", "The whole series"],
                ] as [EditScope, string][]
              ).map(([v, label]) => (
                <button
                  key={v}
                  onClick={() => setScope(v)}
                  className={clsx(
                    "flex-1 rounded-lg border py-2 text-[13px] transition",
                    scope === v
                      ? "border-accent bg-accent/10 text-accent"
                      : "border-border text-txt2 active:bg-surface2"
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            {scope === "occurrence" && (
              <p className="mt-1.5 text-[11px] text-txt3">
                This one stops repeating; the rest of the series carries on.
              </p>
            )}
          </div>
        )}

        <div className="flex items-center justify-between border-t border-border px-4 py-3">
          {mode === "edit" && task && onDelete ? (
            <button
              onClick={() => onDelete(task)}
              className="flex items-center gap-1.5 rounded-lg px-3 py-2.5 text-sm text-txt3 hover:bg-surface2 hover:text-danger md:px-2 md:py-1.5 md:text-xs"
            >
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="rounded-lg border border-border px-4 py-2.5 text-sm text-txt2 hover:bg-surface2 md:px-3 md:py-1.5 md:text-xs"
            >
              Cancel
            </button>
            <button
              onClick={submit}
              disabled={!title.trim()}
              className="rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white disabled:opacity-40 md:px-3 md:py-1.5 md:text-xs"
            >
              {mode === "create" ? "Add task" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** "Jul 12 – Jul 18" for the Sun–Sat week starting at `iso`. */
function weekLabel(iso: string): string {
  const start = new Date(`${iso}T00:00:00`);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const f = (d: Date) =>
    d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `${f(start)} – ${f(end)}`;
}
