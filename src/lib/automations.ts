import type { SupabaseClient } from "@supabase/supabase-js";
import { toISODate } from "@/lib/recurrence";

export type AutomationKind =
  | "recurring_task"
  | "task_completed_followup"
  | "event_prep_task"
  | "due_soon_nudge"
  | "conditional_update";

export type RecurringTaskConfig = {
  title: string;
  daysOfWeek: number[]; // 0 = Sunday .. 6 = Saturday
  project?: string | null;
  priority?: number;
};

export type TaskCompletedFollowupConfig = {
  /** Case-insensitive keyword the completed task's title must contain; empty/undefined = any task */
  filter?: string;
  /** Supports {task} as a placeholder for the completed task's title */
  title: string;
  dueOffsetDays: number;
  project?: string | null;
  priority?: number;
};

export type EventPrepTaskConfig = {
  /** Case-insensitive keyword the new event's title must contain; empty/undefined = any event */
  filter?: string;
  /** Supports {event} as a placeholder for the event's title */
  title: string;
  hoursBefore: number;
  /** "before" (default) schedules the task ahead of the event's start;
   * "after" schedules it that many hours past it — e.g. a same-day
   * post-showing follow-up. Older saved rules have no `when` at all and
   * should keep behaving like "before" did. */
  when?: "before" | "after";
  project?: string | null;
  priority?: number;
};

export type DueSoonNudgeConfig = {
  daysBefore: number;
};

/** "Whenever a task with this tag or project is created/updated, apply these
 * changes to it" — a small general-purpose condition → action rule. This is
 * the one automation kind that runs on every task save (create and edit),
 * not on a specific event, so it's the closest thing to "automations that
 * can do basically anything" within the tag/project/priority/tag space. */
export type ConditionalUpdateConfig = {
  matchField: "tag" | "project";
  matchValue: string;
  setPriority?: number | null;
  setProject?: string | null;
  addTag?: string | null;
};

export type Automation = {
  id: string;
  user_id: string;
  name: string;
  kind: AutomationKind;
  config:
    | RecurringTaskConfig
    | TaskCompletedFollowupConfig
    | EventPrepTaskConfig
    | DueSoonNudgeConfig
    | ConditionalUpdateConfig;
  enabled: boolean;
  last_run_on: string | null;
  created_at: string;
};

/** Minimal shape a conditional_update rule needs to read/write — deliberately
 * loose (not TaskDraft) so this module doesn't import from TaskModal. */
export type ConditionalDraft = {
  priority?: number;
  project?: string | null;
  tags?: string[] | null;
};

/** Fetches enabled automations of a given kind for the current user. */
async function enabledAutomations(supabase: SupabaseClient, kind: AutomationKind): Promise<Automation[]> {
  const { data } = await supabase
    .from("automations")
    .select("*")
    .eq("kind", kind)
    .eq("enabled", true);
  return (data as Automation[] | null) ?? [];
}

function fillTemplate(template: string, placeholder: string, value: string) {
  return template.replaceAll(`{${placeholder}}`, value);
}

/** Fires "when I complete a task" automations — creates any matching follow-up tasks. */
export async function runTaskCompletedAutomations(supabase: SupabaseClient, taskTitle: string) {
  const rules = await enabledAutomations(supabase, "task_completed_followup");
  for (const r of rules) {
    const cfg = r.config as TaskCompletedFollowupConfig;
    if (cfg.filter && !taskTitle.toLowerCase().includes(cfg.filter.toLowerCase())) continue;
    const due = new Date();
    due.setDate(due.getDate() + (cfg.dueOffsetDays ?? 0));
    await supabase.from("tasks").insert({
      title: fillTemplate(cfg.title || "Follow up: {task}", "task", taskTitle),
      due_date: toISODate(due),
      due_kind: "day",
      priority: cfg.priority ?? 0,
      project: cfg.project ?? null,
      shared: false,
    });
  }
}

/** Fires "when I create an event" automations — creates any matching prep tasks. */
export async function runEventCreatedAutomations(supabase: SupabaseClient, eventTitle: string, eventStart: Date) {
  const rules = await enabledAutomations(supabase, "event_prep_task");
  for (const r of rules) {
    const cfg = r.config as EventPrepTaskConfig;
    if (cfg.filter && !eventTitle.toLowerCase().includes(cfg.filter.toLowerCase())) continue;
    const sign = cfg.when === "after" ? 1 : -1;
    const due = new Date(eventStart.getTime() + sign * (cfg.hoursBefore ?? 0) * 3600_000);
    await supabase.from("tasks").insert({
      title: fillTemplate(cfg.title || "Prep for {event}", "event", eventTitle),
      due_date: toISODate(due),
      due_kind: "day",
      priority: cfg.priority ?? 0,
      project: cfg.project ?? null,
      shared: false,
    });
  }
}

/** Applies any matching conditional_update rules to a task draft BEFORE it's
 * saved, so "if a task has tag X / is in project Y, set its priority to Z"
 * takes effect on both create and edit — call this right before the
 * supabase insert/update in every task-save path. Mutating the draft here
 * (rather than patching after the fact) means the change lands in the same
 * write, with no extra round trip and no risk of the UI briefly showing the
 * pre-automation value. */
export async function applyConditionalAutomations<T extends ConditionalDraft>(
  supabase: SupabaseClient,
  draft: T
): Promise<T> {
  const rules = await enabledAutomations(supabase, "conditional_update");
  if (rules.length === 0) return draft;
  let next: T = { ...draft };
  for (const r of rules) {
    const cfg = r.config as ConditionalUpdateConfig;
    if (!cfg.matchValue) continue;
    const needle = cfg.matchValue.toLowerCase();
    const matches =
      cfg.matchField === "tag"
        ? (next.tags ?? []).some((t) => t.toLowerCase() === needle)
        : (next.project ?? "").toLowerCase() === needle;
    if (!matches) continue;
    if (cfg.setPriority != null) next = { ...next, priority: cfg.setPriority };
    if (cfg.setProject) next = { ...next, project: cfg.setProject };
    if (cfg.addTag) {
      const existing = next.tags ?? [];
      if (!existing.some((t) => t.toLowerCase() === cfg.addTag!.toLowerCase())) {
        next = { ...next, tags: [...existing, cfg.addTag] };
      }
    }
  }
  return next;
}

export const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
