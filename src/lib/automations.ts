import type { SupabaseClient } from "@supabase/supabase-js";
import { toISODate } from "@/lib/recurrence";

export type AutomationKind =
  | "recurring_task"
  | "task_completed_followup"
  | "event_prep_task"
  | "due_soon_nudge";

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
  /** Supports {event} as a placeholder for the event's title */
  title: string;
  hoursBefore: number;
  project?: string | null;
  priority?: number;
};

export type DueSoonNudgeConfig = {
  daysBefore: number;
};

export type Automation = {
  id: string;
  user_id: string;
  name: string;
  kind: AutomationKind;
  config: RecurringTaskConfig | TaskCompletedFollowupConfig | EventPrepTaskConfig | DueSoonNudgeConfig;
  enabled: boolean;
  last_run_on: string | null;
  created_at: string;
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
    const due = new Date(eventStart.getTime() - (cfg.hoursBefore ?? 0) * 3600_000);
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

export const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
