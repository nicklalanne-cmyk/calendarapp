"use client";

import { useEffect, useState } from "react";
import { Zap, Plus, Trash2, X, Copy } from "lucide-react";
import clsx from "clsx";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/lib/toast";
import {
  DAY_NAMES,
  TRIGGER_LABEL,
  TRIGGER_ENTITY_TABLE,
  FIELDS_BY_TRIGGER,
  type Automation,
  type TriggerType,
  type Condition,
  type ConditionField,
  type ConditionOp,
  type Action,
  type RuleConfig,
} from "@/lib/automations";

const TRIGGERS = Object.keys(TRIGGER_LABEL) as TriggerType[];

const FIELD_LABEL: Record<ConditionField, string> = {
  title: "Title",
  project: "Project",
  tag: "Tag",
  priority: "Priority",
  location: "Location",
  body: "Body",
  source: "Source",
};

const OPS_BY_FIELD: Record<ConditionField, ConditionOp[]> = {
  title: ["contains", "not_contains", "equals", "is_set", "is_not_set"],
  project: ["equals", "contains", "is_set", "is_not_set"],
  tag: ["equals", "contains", "is_set", "is_not_set"],
  priority: ["equals", "gte", "lte"],
  location: ["contains", "not_contains", "equals", "is_set", "is_not_set"],
  body: ["contains", "not_contains", "is_set", "is_not_set"],
  source: ["equals", "contains", "is_set", "is_not_set"],
};

const OP_LABEL: Record<ConditionOp, string> = {
  contains: "contains",
  not_contains: "doesn't contain",
  equals: "is",
  gte: "is at least",
  lte: "is at most",
  is_set: "is set",
  is_not_set: "isn't set",
};

const ACTION_TYPE_LABEL: Record<Action["type"], string> = {
  create_task: "Create a task",
  update_item: "Update the triggering item",
  send_notification: "Send a notification",
  create_note: "Create a note",
};

function defaultAction(type: Action["type"]): Action {
  if (type === "create_task") return { type, title: "{title}", dueOffsetDays: 0, project: null, priority: 0, tag: null };
  if (type === "update_item") return { type, setPriority: null, setProject: null, addTag: null, setDueOffsetDays: null };
  if (type === "send_notification") return { type, title: "{title}", body: "" };
  return { type: "create_note", title: "{title}", body: "", appendToDaily: false };
}

function summarize(cfg: RuleConfig): string {
  const trigger = TRIGGER_LABEL[cfg.trigger] ?? cfg.trigger;
  const actionBits = (cfg.actions ?? []).map((a) => ACTION_TYPE_LABEL[a.type]);
  const cond = (cfg.conditions ?? []).length;
  const parts = [trigger];
  if (cond > 0) parts.push(`${cond} condition${cond === 1 ? "" : "s"}`);
  if (actionBits.length > 0) parts.push(`→ ${actionBits.join(", ")}`);
  return parts.join(" · ");
}

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
    const h = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.automations) load();
    };
    window.addEventListener("cadence:ai-mutated", h as EventListener);
    return () => window.removeEventListener("cadence:ai-mutated", h as EventListener);
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

  const duplicate = async (a: Automation) => {
    const { data, error } = await supabase
      .from("automations")
      .insert({ name: `${a.name} (copy)`, kind: "rule", config: a.config, enabled: false })
      .select()
      .single();
    if (error || !data) return toast(error?.message ?? "Couldn't duplicate", "error");
    // Duplicated disabled by default — two identical enabled rules would
    // otherwise both fire on the very next matching event.
    setRows((cur) => [data as Automation, ...cur]);
    toast(`Duplicated as "${(data as Automation).name}" (disabled)`);
  };

  // Automations have no deleted_at column (unlike tasks/notes/notebooks), so
  // a real soft-delete-then-restore isn't available here. Instead: remove it
  // from view immediately, but hold off on the actual delete for a few
  // seconds so "Undo" has something to cancel — matching the toast-with-Undo
  // pattern used everywhere else in the app instead of deleting instantly
  // with no way back.
  const remove = (a: Automation) => {
    const idx = rows.findIndex((x) => x.id === a.id);
    setRows((cur) => cur.filter((x) => x.id !== a.id));
    let cancelled = false;
    const timer = setTimeout(async () => {
      if (cancelled) return;
      const { error } = await supabase.from("automations").delete().eq("id", a.id);
      if (error) {
        toast(error.message, "error");
        load();
      }
    }, 6000);
    toast(`Deleted "${a.name}"`, {
      action: {
        label: "Undo",
        run: () => {
          cancelled = true;
          clearTimeout(timer);
          setRows((cur) => {
            const next = [...cur];
            next.splice(Math.min(idx, next.length), 0, a);
            return next;
          });
        },
      },
    });
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
          No automations yet. Build an if/then rule: pick a trigger, add conditions to narrow it down, then choose
          what should happen.
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((a) => (
            <div key={a.id} className="flex items-center gap-3 rounded-xl border border-border bg-surface p-3">
              <Zap className="h-4 w-4 shrink-0 text-txt3" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-txt">{a.name}</div>
                <div className="truncate text-xs text-txt3">{summarize(a.config)}</div>
                <div className="truncate text-[11px] text-txt3">
                  {a.last_run_on
                    ? `Last ran ${new Date(`${a.last_run_on}T00:00:00`).toLocaleDateString()}`
                    : "Never run yet"}
                </div>
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
                onClick={() => duplicate(a)}
                title="Duplicate"
                aria-label="Duplicate"
                className="rounded-md p-1.5 text-txt3 hover:bg-surface2 hover:text-txt2"
              >
                <Copy className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => remove(a)}
                className="rounded-md p-1.5 text-txt3 hover:bg-danger/10 hover:text-danger"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
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

const inputCls =
  "w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent";
const labelCls = "mb-1 block text-[11px] font-semibold uppercase tracking-wide text-txt3";

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
  const [name, setName] = useState(automation?.name ?? "");
  const [saving, setSaving] = useState(false);

  const cfg = automation?.config;
  const [trigger, setTrigger] = useState<TriggerType>(cfg?.trigger ?? "task_created");
  const [conditions, setConditions] = useState<Condition[]>(cfg?.conditions ?? []);
  const [matchType, setMatchType] = useState<"all" | "any">(cfg?.matchType ?? "all");
  const [actions, setActions] = useState<Action[]>(cfg?.actions ?? [defaultAction("create_task")]);
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>(cfg?.daysOfWeek ?? [1, 2, 3, 4, 5]);
  const [daysOffset, setDaysOffset] = useState<number>(cfg?.daysOffset ?? 1);

  const fields = FIELDS_BY_TRIGGER[trigger];
  const canUpdateItem = !!TRIGGER_ENTITY_TABLE[trigger];

  // If switching to a trigger that doesn't support update_item, drop any such
  // actions rather than silently saving something that can never fire.
  const changeTrigger = (t: TriggerType) => {
    setTrigger(t);
    if (!TRIGGER_ENTITY_TABLE[t]) {
      setActions((cur) => cur.filter((a) => a.type !== "update_item"));
    }
    // Reset conditions whose field isn't offered for the new trigger.
    setConditions((cur) => cur.filter((c) => FIELDS_BY_TRIGGER[t].includes(c.field)));
  };

  const toggleDay = (d: number) =>
    setDaysOfWeek((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d].sort()));

  const addCondition = () => {
    if (fields.length === 0) return;
    setConditions((cur) => [...cur, { field: fields[0], op: OPS_BY_FIELD[fields[0]][0], value: "" }]);
  };
  const updateCondition = (i: number, patch: Partial<Condition>) =>
    setConditions((cur) => cur.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  const removeCondition = (i: number) => setConditions((cur) => cur.filter((_, idx) => idx !== i));

  const addAction = () => setActions((cur) => [...cur, defaultAction("create_task")]);
  const updateAction = (i: number, patch: Partial<Action>) =>
    setActions((cur) => cur.map((a, idx) => (idx === i ? ({ ...a, ...patch } as Action) : a)));
  const removeAction = (i: number) => setActions((cur) => cur.filter((_, idx) => idx !== i));

  const save = async () => {
    if (!name.trim()) return toast("Give this automation a name", "error");
    if (trigger === "schedule_weekly" && daysOfWeek.length === 0) {
      return toast("Pick at least one day of the week", "error");
    }
    if (actions.length === 0) return toast("Add at least one action", "error");
    for (const a of actions) {
      if ((a.type === "create_task" || a.type === "send_notification" || a.type === "create_note") && !a.title?.trim()) {
        return toast("Every action needs a title", "error");
      }
    }

    const config: RuleConfig = {
      trigger,
      conditions,
      matchType: conditions.length > 1 ? matchType : undefined,
      actions,
      ...(trigger === "schedule_weekly" ? { daysOfWeek } : {}),
      ...(trigger === "date_relative" ? { daysOffset } : {}),
    };

    setSaving(true);
    const payload = { name, kind: "rule" as const, config, enabled: true };
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

        <label className={labelCls}>Name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Weekly review"
          className={clsx(inputCls, "mb-3")}
        />

        {/* ---- IF ---- */}
        <div className="mb-4 rounded-xl border border-border p-3">
          <div className="mb-2 text-xs font-semibold text-accent">IF</div>
          <label className={labelCls}>Trigger</label>
          <select
            value={trigger}
            onChange={(e) => changeTrigger(e.target.value as TriggerType)}
            className={clsx(inputCls, "mb-3")}
          >
            {TRIGGERS.map((t) => (
              <option key={t} value={t}>
                {TRIGGER_LABEL[t]}
              </option>
            ))}
          </select>

          {trigger === "schedule_weekly" && (
            <>
              <label className={labelCls}>Days</label>
              <div className="mb-3 flex gap-1">
                {DAY_NAMES.map((d, i) => (
                  <button
                    key={d}
                    onClick={() => toggleDay(i)}
                    className={clsx(
                      "h-8 flex-1 rounded-lg text-xs font-medium",
                      daysOfWeek.includes(i) ? "bg-accent text-white" : "bg-surface2 text-txt2"
                    )}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </>
          )}

          {trigger === "date_relative" && (
            <>
              <label className={labelCls}>Days before the due date</label>
              <input
                type="number"
                value={daysOffset}
                onChange={(e) => setDaysOffset(Number(e.target.value) || 0)}
                className={clsx(inputCls, "mb-3")}
              />
            </>
          )}

          {fields.length > 0 && (
            <>
              <div className="mb-1 flex items-center justify-between">
                <label className={clsx(labelCls, "mb-0")}>Conditions (optional)</label>
                {conditions.length > 1 && (
                  <div className="flex overflow-hidden rounded-md border border-border text-[11px]">
                    {(["all", "any"] as const).map((v) => (
                      <button
                        key={v}
                        onClick={() => setMatchType(v)}
                        className={clsx(
                          "px-2 py-1",
                          matchType === v ? "bg-accent text-white" : "bg-bg text-txt3 hover:text-txt2"
                        )}
                      >
                        Match {v === "all" ? "ALL" : "ANY"}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="mb-2 flex flex-col gap-2">
                {conditions.map((c, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    <select
                      value={c.field}
                      onChange={(e) => {
                        const f = e.target.value as ConditionField;
                        updateCondition(i, { field: f, op: OPS_BY_FIELD[f][0] });
                      }}
                      className="rounded-lg border border-border bg-bg px-2 py-1.5 text-xs outline-none focus:border-accent"
                    >
                      {fields.map((f) => (
                        <option key={f} value={f}>
                          {FIELD_LABEL[f]}
                        </option>
                      ))}
                    </select>
                    <select
                      value={c.op}
                      onChange={(e) => updateCondition(i, { op: e.target.value as ConditionOp })}
                      className="rounded-lg border border-border bg-bg px-2 py-1.5 text-xs outline-none focus:border-accent"
                    >
                      {OPS_BY_FIELD[c.field].map((op) => (
                        <option key={op} value={op}>
                          {OP_LABEL[op]}
                        </option>
                      ))}
                    </select>
                    {c.op !== "is_set" && c.op !== "is_not_set" && (
                      <input
                        value={c.value ?? ""}
                        onChange={(e) => updateCondition(i, { value: e.target.value })}
                        placeholder="value"
                        className="min-w-0 flex-1 rounded-lg border border-border bg-bg px-2 py-1.5 text-xs outline-none focus:border-accent"
                      />
                    )}
                    <button
                      onClick={() => removeCondition(i)}
                      className="shrink-0 rounded-md p-1.5 text-txt3 hover:bg-danger/10 hover:text-danger"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
              <button
                onClick={addCondition}
                className="mb-1 flex items-center gap-1 text-xs font-medium text-accent hover:text-accentSoft"
              >
                <Plus className="h-3.5 w-3.5" /> Add condition
              </button>
            </>
          )}
        </div>

        {/* ---- THEN ---- */}
        <div className="mb-4 rounded-xl border border-border p-3">
          <div className="mb-2 text-xs font-semibold text-accent">THEN</div>
          <div className="flex flex-col gap-3">
            {actions.map((a, i) => (
              <ActionEditor
                key={i}
                action={a}
                canUpdateItem={canUpdateItem}
                onChange={(patch) => updateAction(i, patch)}
                onTypeChange={(type) => updateAction(i, defaultAction(type))}
                onRemove={() => removeAction(i)}
              />
            ))}
          </div>
          <button
            onClick={addAction}
            className="mt-2 flex items-center gap-1 text-xs font-medium text-accent hover:text-accentSoft"
          >
            <Plus className="h-3.5 w-3.5" /> Add action
          </button>
        </div>

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

function ActionEditor({
  action,
  canUpdateItem,
  onChange,
  onTypeChange,
  onRemove,
}: {
  action: Action;
  canUpdateItem: boolean;
  onChange: (patch: Partial<Action>) => void;
  onTypeChange: (type: Action["type"]) => void;
  onRemove: () => void;
}) {
  const types: Action["type"][] = ["create_task", "send_notification", "create_note"];
  if (canUpdateItem) types.splice(1, 0, "update_item");

  return (
    <div className="rounded-lg border border-border bg-bg/50 p-2.5">
      <div className="mb-2 flex items-center gap-1.5">
        <select
          value={action.type}
          onChange={(e) => onTypeChange(e.target.value as Action["type"])}
          className="flex-1 rounded-lg border border-border bg-bg px-2 py-1.5 text-xs outline-none focus:border-accent"
        >
          {types.map((t) => (
            <option key={t} value={t}>
              {ACTION_TYPE_LABEL[t]}
            </option>
          ))}
        </select>
        <button onClick={onRemove} className="shrink-0 rounded-md p-1.5 text-txt3 hover:bg-danger/10 hover:text-danger">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {action.type === "create_task" && (
        <div className="flex flex-col gap-1.5">
          <input
            value={action.title}
            onChange={(e) => onChange({ title: e.target.value })}
            placeholder="Task title — use {title} for the trigger's title"
            className="rounded-lg border border-border bg-bg px-2 py-1.5 text-xs outline-none focus:border-accent"
          />
          <div className="flex gap-1.5">
            <input
              type="number"
              value={action.dueOffsetDays ?? 0}
              onChange={(e) => onChange({ dueOffsetDays: Number(e.target.value) || 0 })}
              placeholder="Due offset (days)"
              className="w-32 rounded-lg border border-border bg-bg px-2 py-1.5 text-xs outline-none focus:border-accent"
            />
            <input
              value={action.project ?? ""}
              onChange={(e) => onChange({ project: e.target.value || null })}
              placeholder="Project (optional)"
              className="flex-1 rounded-lg border border-border bg-bg px-2 py-1.5 text-xs outline-none focus:border-accent"
            />
          </div>
          <div className="flex gap-1.5">
            <select
              value={String(action.priority ?? 0)}
              onChange={(e) => onChange({ priority: Number(e.target.value) })}
              className="w-24 rounded-lg border border-border bg-bg px-2 py-1.5 text-xs outline-none focus:border-accent"
            >
              <option value="0">No priority</option>
              <option value="1">P1</option>
              <option value="2">P2</option>
              <option value="3">P3</option>
              <option value="4">P4</option>
            </select>
            <input
              value={action.tag ?? ""}
              onChange={(e) => onChange({ tag: e.target.value || null })}
              placeholder="Tag (optional)"
              className="flex-1 rounded-lg border border-border bg-bg px-2 py-1.5 text-xs outline-none focus:border-accent"
            />
          </div>
          <p className="text-[10px] text-txt3">Due offset: negative = before, positive = after the trigger's anchor date.</p>
        </div>
      )}

      {action.type === "update_item" && (
        <div className="flex flex-col gap-1.5">
          <div className="flex gap-1.5">
            <select
              value={action.setPriority != null ? String(action.setPriority) : ""}
              onChange={(e) => onChange({ setPriority: e.target.value ? Number(e.target.value) : null })}
              className="flex-1 rounded-lg border border-border bg-bg px-2 py-1.5 text-xs outline-none focus:border-accent"
            >
              <option value="">Don&apos;t change priority</option>
              <option value="0">None</option>
              <option value="1">P1</option>
              <option value="2">P2</option>
              <option value="3">P3</option>
              <option value="4">P4</option>
            </select>
            <input
              value={action.setProject ?? ""}
              onChange={(e) => onChange({ setProject: e.target.value || null })}
              placeholder="Set project (optional)"
              className="flex-1 rounded-lg border border-border bg-bg px-2 py-1.5 text-xs outline-none focus:border-accent"
            />
          </div>
          <div className="flex gap-1.5">
            <input
              value={action.addTag ?? ""}
              onChange={(e) => onChange({ addTag: e.target.value || null })}
              placeholder="Add tag (optional)"
              className="flex-1 rounded-lg border border-border bg-bg px-2 py-1.5 text-xs outline-none focus:border-accent"
            />
            <input
              type="number"
              value={action.setDueOffsetDays ?? ""}
              onChange={(e) => onChange({ setDueOffsetDays: e.target.value ? Number(e.target.value) : null })}
              placeholder="Set due, days from now"
              className="flex-1 rounded-lg border border-border bg-bg px-2 py-1.5 text-xs outline-none focus:border-accent"
            />
          </div>
        </div>
      )}

      {action.type === "send_notification" && (
        <div className="flex flex-col gap-1.5">
          <input
            value={action.title}
            onChange={(e) => onChange({ title: e.target.value })}
            placeholder="Notification title"
            className="rounded-lg border border-border bg-bg px-2 py-1.5 text-xs outline-none focus:border-accent"
          />
          <input
            value={action.body}
            onChange={(e) => onChange({ body: e.target.value })}
            placeholder="Body — use {title} for the trigger's title"
            className="rounded-lg border border-border bg-bg px-2 py-1.5 text-xs outline-none focus:border-accent"
          />
        </div>
      )}

      {action.type === "create_note" && (
        <div className="flex flex-col gap-1.5">
          <input
            value={action.title}
            onChange={(e) => onChange({ title: e.target.value })}
            placeholder="Note title"
            className="rounded-lg border border-border bg-bg px-2 py-1.5 text-xs outline-none focus:border-accent"
          />
          <input
            value={action.body}
            onChange={(e) => onChange({ body: e.target.value })}
            placeholder="Note body (optional)"
            className="rounded-lg border border-border bg-bg px-2 py-1.5 text-xs outline-none focus:border-accent"
          />
          <label className="flex items-center gap-1.5 text-xs text-txt2">
            <input
              type="checkbox"
              checked={!!action.appendToDaily}
              onChange={(e) => onChange({ appendToDaily: e.target.checked })}
            />
            Append to today&apos;s daily note instead of creating a new one
          </label>
        </div>
      )}
    </div>
  );
}
