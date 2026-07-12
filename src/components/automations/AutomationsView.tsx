"use client";

import { useEffect, useState } from "react";
import { Zap, Plus, Trash2, X, Repeat, CheckCircle2, CalendarPlus, BellRing } from "lucide-react";
import clsx from "clsx";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/lib/toast";
import { DAY_NAMES, type Automation, type AutomationKind } from "@/lib/automations";

const KIND_META: Record<AutomationKind, { label: string; icon: React.ElementType; blurb: string }> = {
  recurring_task: {
    label: "Recurring task",
    icon: Repeat,
    blurb: "Create a task automatically on chosen days of the week.",
  },
  task_completed_followup: {
    label: "Task completed → follow-up task",
    icon: CheckCircle2,
    blurb: "When you finish a task, automatically create a follow-up.",
  },
  event_prep_task: {
    label: "Event created → prep task",
    icon: CalendarPlus,
    blurb: "When you add a calendar event, automatically create a prep task before it.",
  },
  due_soon_nudge: {
    label: "Due-soon nudge",
    icon: BellRing,
    blurb: "Get a push notification a few days before a task's due date.",
  },
};

export default function AutomationsView() {
  const supabase = createClient();
  const [rows, setRows] = useState<Automation[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Automation | "new" | null>(null);

  const load = async () => {
    const { data, error } = await supabase
      .from("automations")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) toast(error.message, "error");
    setRows((data as Automation[]) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = async (a: Automation) => {
    setRows((cur) => cur.map((x) => (x.id === a.id ? { ...x, enabled: !a.enabled } : x)));
    const { error } = await supabase.from("automations").update({ enabled: !a.enabled }).eq("id", a.id);
    if (error) {
      toast(error.message, "error");
      load();
    }
  };

  const remove = async (a: Automation) => {
    setRows((cur) => cur.filter((x) => x.id !== a.id));
    const { error } = await supabase.from("automations").delete().eq("id", a.id);
    if (error) {
      toast(error.message, "error");
      load();
    }
  };

  return (
    <div className="mx-auto max-w-2xl p-4 md:p-6">
      <header className="mb-5 flex items-center gap-2">
        <Zap className="h-5 w-5 text-accent" />
        <h1 className="text-lg font-semibold">Automations</h1>
        <button
          onClick={() => setEditing("new")}
          className="ml-auto flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accentSoft"
        >
          <Plus className="h-4 w-4" /> New
        </button>
      </header>

      {loading ? (
        <p className="text-sm text-txt3">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-txt3">
          No automations yet. Create rules for recurring tasks, follow-ups after you finish a task, prep tasks
          before events, or reminders as a due date approaches.
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((a) => {
            const meta = KIND_META[a.kind];
            const Icon = meta.icon;
            return (
              <div
                key={a.id}
                className="flex items-center gap-3 rounded-xl border border-border bg-surface p-3"
              >
                <Icon className="h-4 w-4 shrink-0 text-txt3" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-txt">{a.name}</div>
                  <div className="truncate text-xs text-txt3">{meta.label}</div>
                </div>
                <button
                  onClick={() => toggle(a)}
                  className={clsx(
                    "relative h-6 w-11 shrink-0 rounded-full transition",
                    a.enabled ? "bg-accent" : "bg-surface2"
                  )}
                  title={a.enabled ? "Enabled" : "Disabled"}
                >
                  <span
                    className={clsx(
                      "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition",
                      a.enabled ? "left-[22px]" : "left-0.5"
                    )}
                  />
                </button>
                <button
                  onClick={() => setEditing(a)}
                  className="rounded-md px-2 py-1 text-xs text-txt2 hover:bg-surface2"
                >
                  Edit
                </button>
                <button
                  onClick={() => remove(a)}
                  className="rounded-md p-1.5 text-txt3 hover:bg-danger/10 hover:text-danger"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {editing && (
        <AutomationModal
          automation={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function AutomationModal({
  automation,
  onClose,
  onSaved,
}: {
  automation: Automation | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const supabase = createClient();
  const [kind, setKind] = useState<AutomationKind>(automation?.kind ?? "recurring_task");
  const [name, setName] = useState(automation?.name ?? "");
  const [saving, setSaving] = useState(false);

  // recurring_task
  const rtCfg = automation?.kind === "recurring_task" ? (automation.config as { title?: string; daysOfWeek?: number[] }) : null;
  const [rtTitle, setRtTitle] = useState(rtCfg?.title ?? "");
  const [rtDays, setRtDays] = useState<number[]>(rtCfg?.daysOfWeek ?? [1, 2, 3, 4, 5]);

  // task_completed_followup
  const tcCfg =
    automation?.kind === "task_completed_followup"
      ? (automation.config as { filter?: string; title?: string; dueOffsetDays?: number })
      : null;
  const [tcFilter, setTcFilter] = useState(tcCfg?.filter ?? "");
  const [tcTitle, setTcTitle] = useState(tcCfg?.title ?? "Follow up: {task}");
  const [tcOffset, setTcOffset] = useState(tcCfg?.dueOffsetDays ?? 3);

  // event_prep_task
  const epCfg = automation?.kind === "event_prep_task" ? (automation.config as { title?: string; hoursBefore?: number }) : null;
  const [epTitle, setEpTitle] = useState(epCfg?.title ?? "Prep for {event}");
  const [epHours, setEpHours] = useState(epCfg?.hoursBefore ?? 24);

  // due_soon_nudge
  const dsCfg = automation?.kind === "due_soon_nudge" ? (automation.config as { daysBefore?: number }) : null;
  const [dsDays, setDsDays] = useState(dsCfg?.daysBefore ?? 1);

  const toggleDay = (d: number) =>
    setRtDays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d].sort()));

  const save = async () => {
    if (!name.trim()) return toast("Give this automation a name", "error");
    let config: Record<string, unknown> = {};
    if (kind === "recurring_task") {
      if (!rtTitle.trim()) return toast("Task title is required", "error");
      config = { title: rtTitle, daysOfWeek: rtDays };
    } else if (kind === "task_completed_followup") {
      if (!tcTitle.trim()) return toast("Follow-up title is required", "error");
      config = { filter: tcFilter || undefined, title: tcTitle, dueOffsetDays: tcOffset };
    } else if (kind === "event_prep_task") {
      if (!epTitle.trim()) return toast("Prep task title is required", "error");
      config = { title: epTitle, hoursBefore: epHours };
    } else {
      config = { daysBefore: dsDays };
    }

    setSaving(true);
    const payload = { name, kind, config, enabled: true };
    const { error } = automation
      ? await supabase.from("automations").update(payload).eq("id", automation.id)
      : await supabase.from("automations").insert(payload);
    setSaving(false);
    if (error) return toast(error.message, "error");
    onSaved();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 md:items-center" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-surface p-4 md:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">{automation ? "Edit automation" : "New automation"}</h2>
          <button onClick={onClose} className="rounded p-1 text-txt3 hover:bg-surface2">
            <X className="h-4 w-4" />
          </button>
        </div>

        <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-txt3">Name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Weekly review"
          className="mb-3 w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
        />

        <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-txt3">Trigger & action</label>
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as AutomationKind)}
          className="mb-3 w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
        >
          {(Object.keys(KIND_META) as AutomationKind[]).map((k) => (
            <option key={k} value={k}>
              {KIND_META[k].label}
            </option>
          ))}
        </select>
        <p className="mb-4 text-xs text-txt3">{KIND_META[kind].blurb}</p>

        {kind === "recurring_task" && (
          <>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-txt3">Task title</label>
            <input
              value={rtTitle}
              onChange={(e) => setRtTitle(e.target.value)}
              placeholder="e.g. Weekly review"
              className="mb-3 w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
            />
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-txt3">Days</label>
            <div className="mb-3 flex gap-1">
              {DAY_NAMES.map((d, i) => (
                <button
                  key={d}
                  onClick={() => toggleDay(i)}
                  className={clsx(
                    "h-8 flex-1 rounded-lg text-xs font-medium",
                    rtDays.includes(i) ? "bg-accent text-white" : "bg-surface2 text-txt2"
                  )}
                >
                  {d}
                </button>
              ))}
            </div>
          </>
        )}

        {kind === "task_completed_followup" && (
          <>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-txt3">
              Only when task title contains (optional)
            </label>
            <input
              value={tcFilter}
              onChange={(e) => setTcFilter(e.target.value)}
              placeholder="Leave blank to match any task"
              className="mb-3 w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
            />
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-txt3">
              Follow-up task title
            </label>
            <input
              value={tcTitle}
              onChange={(e) => setTcTitle(e.target.value)}
              placeholder="Follow up: {task}"
              className="mb-1 w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
            />
            <p className="mb-3 text-[11px] text-txt3">{"Use {task} for the completed task's title."}</p>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-txt3">
              Due, days after completion
            </label>
            <input
              type="number"
              min={0}
              value={tcOffset}
              onChange={(e) => setTcOffset(Number(e.target.value) || 0)}
              className="mb-3 w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
            />
          </>
        )}

        {kind === "event_prep_task" && (
          <>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-txt3">Prep task title</label>
            <input
              value={epTitle}
              onChange={(e) => setEpTitle(e.target.value)}
              placeholder="Prep for {event}"
              className="mb-1 w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
            />
            <p className="mb-3 text-[11px] text-txt3">{"Use {event} for the new event's title."}</p>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-txt3">Hours before the event</label>
            <input
              type="number"
              min={0}
              value={epHours}
              onChange={(e) => setEpHours(Number(e.target.value) || 0)}
              className="mb-3 w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
            />
          </>
        )}

        {kind === "due_soon_nudge" && (
          <>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-txt3">
              Days before the due date
            </label>
            <input
              type="number"
              min={0}
              value={dsDays}
              onChange={(e) => setDsDays(Number(e.target.value) || 0)}
              className="mb-3 w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
            />
            <p className="mb-3 text-[11px] text-txt3">
              Requires push notifications to be enabled in Settings — sent once per task, around 7am your local time.
            </p>
          </>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-sm text-txt2 hover:bg-surface2">
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accentSoft disabled:opacity-50"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
