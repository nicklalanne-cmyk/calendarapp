import type { SupabaseClient } from "@supabase/supabase-js";
import { toISODate } from "@/lib/recurrence";

/**
 * Generic if/then automation engine — replaces the old fixed set of five
 * hardcoded automation "kinds" (recurring_task, task_completed_followup,
 * event_prep_task, due_soon_nudge, conditional_update) with one flexible
 * rule shape: a trigger, a list of AND-ed conditions, and a list of actions.
 * Every automation row now has kind = "rule"; the actual behavior lives
 * entirely in `config` (see RuleConfig below).
 */

export type TriggerType =
  | "event_created"
  | "event_updated"
  | "task_created"
  | "task_updated"
  /** Fires on EITHER task_created or task_updated — the common case for
   * "whenever a task with this tag/project is saved, do X" rules that don't
   * care whether the task is new or being edited. */
  | "task_saved"
  | "task_completed"
  | "note_created"
  /** Fires once per matching calendar day, on the configured days of week —
   * no specific triggering item (e.g. "every Monday, create a task"). */
  | "schedule_weekly"
  /** Fires once per task whose due_date is N days from today — the
   * triggering item is that task. */
  | "date_relative";

export const TRIGGER_LABEL: Record<TriggerType, string> = {
  event_created: "An event is created",
  event_updated: "An event is edited",
  task_created: "A task is created",
  task_updated: "A task is edited",
  task_saved: "A task is created or edited",
  task_completed: "A task is completed",
  note_created: "A note is created",
  schedule_weekly: "On a schedule (days of week)",
  date_relative: "A task's due date is coming up",
};

/** Which trigger types have a concrete triggering row to run "Update the
 * triggering item" against, and which condition fields make sense for each. */
export const TRIGGER_ENTITY_TABLE: Partial<Record<TriggerType, "tasks">> = {
  task_created: "tasks",
  task_updated: "tasks",
  task_saved: "tasks",
  task_completed: "tasks",
  date_relative: "tasks",
};

export type ConditionField = "title" | "project" | "tag" | "priority" | "location" | "body" | "source";
export type ConditionOp = "contains" | "not_contains" | "equals" | "gte" | "lte" | "is_set" | "is_not_set";

export const FIELDS_BY_TRIGGER: Record<TriggerType, ConditionField[]> = {
  event_created: ["title", "location"],
  event_updated: ["title", "location"],
  task_created: ["title", "project", "tag", "priority"],
  task_updated: ["title", "project", "tag", "priority"],
  task_saved: ["title", "project", "tag", "priority"],
  task_completed: ["title", "project", "tag", "priority"],
  note_created: ["title", "body", "source"],
  schedule_weekly: [],
  date_relative: ["title", "project", "tag", "priority"],
};

export type Condition = {
  field: ConditionField;
  op: ConditionOp;
  value?: string;
};

export type CreateTaskAction = {
  type: "create_task";
  /** Supports {title} as a placeholder for the triggering item's title */
  title: string;
  dueOffsetDays?: number;
  project?: string | null;
  priority?: number;
  tag?: string | null;
};

export type UpdateItemAction = {
  type: "update_item";
  setPriority?: number | null;
  setProject?: string | null;
  addTag?: string | null;
  setDueOffsetDays?: number | null;
};

export type SendNotificationAction = {
  type: "send_notification";
  title: string;
  body: string;
};

export type CreateNoteAction = {
  type: "create_note";
  title: string;
  body: string;
  /** Append to today's daily note instead of creating a new standalone one */
  appendToDaily?: boolean;
};

export type Action = CreateTaskAction | UpdateItemAction | SendNotificationAction | CreateNoteAction;

export type RuleConfig = {
  trigger: TriggerType;
  conditions: Condition[];
  actions: Action[];
  /** schedule_weekly only: 0 = Sunday .. 6 = Saturday */
  daysOfWeek?: number[];
  /** date_relative only: days before (positive) the task's due_date */
  daysOffset?: number;
};

export type Automation = {
  id: string;
  user_id: string;
  name: string;
  kind: "rule";
  config: RuleConfig;
  enabled: boolean;
  last_run_on: string | null;
  created_at: string;
};

export const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** The triggering item's relevant fields — what conditions match against and
 * what {title} template-fills use. */
export type RuleContext = {
  title: string;
  project?: string | null;
  tags?: string[] | null;
  priority?: number | null;
  location?: string | null;
  body?: string | null;
  source?: string | null;
  /** Basis for dueOffsetDays math in create_task actions — the event's
   * start, the task's own due date, or "now" for triggers with no natural
   * anchor date. */
  anchorDate: Date;
  /** What "Update the triggering item" patches — absent for triggers with no
   * concrete row of their own (event_created/updated live in Google
   * Calendar, not a table this app owns). */
  entity?: { table: "tasks"; id: string } | null;
};

function fillTemplate(template: string, title: string) {
  return template.replaceAll("{title}", title);
}

function fieldMatches(ctx: RuleContext, c: Condition): boolean {
  if (c.field === "tag") {
    const tags = (ctx.tags ?? []).map((t) => t.toLowerCase());
    const needle = (c.value ?? "").toLowerCase();
    if (c.op === "is_set") return tags.length > 0;
    if (c.op === "is_not_set") return tags.length === 0;
    if (c.op === "equals") return tags.includes(needle);
    if (c.op === "not_contains") return !tags.some((t) => t.includes(needle));
    return tags.some((t) => t.includes(needle)); // contains (default)
  }
  const raw: string | number | null | undefined =
    c.field === "title"
      ? ctx.title
      : c.field === "project"
        ? ctx.project
        : c.field === "priority"
          ? (ctx.priority ?? 0)
          : c.field === "location"
            ? ctx.location
            : c.field === "body"
              ? ctx.body
              : ctx.source;
  if (c.op === "is_set") return raw != null && raw !== "";
  if (c.op === "is_not_set") return raw == null || raw === "";
  if (c.op === "gte") return Number(raw ?? 0) >= Number(c.value ?? 0);
  if (c.op === "lte") return Number(raw ?? 0) <= Number(c.value ?? 0);
  const a = String(raw ?? "").toLowerCase();
  const b = String(c.value ?? "").toLowerCase();
  if (c.op === "equals") return a === b;
  if (c.op === "not_contains") return !a.includes(b);
  return a.includes(b); // contains (default)
}

export function matchesAll(ctx: RuleContext, conditions: Condition[]): boolean {
  return (conditions ?? []).every((c) => fieldMatches(ctx, c));
}

/** Exported for the cron route, which needs to scope rules to a specific
 * trigger (schedule_weekly / date_relative) and user before running its own
 * per-entity dedup logic against automation_fires. */
export async function rulesForTrigger(supabase: SupabaseClient, trigger: TriggerType): Promise<Automation[]> {
  const { data } = await supabase.from("automations").select("*").eq("enabled", true).eq("kind", "rule");
  const rows = (data as Automation[] | null) ?? [];
  return rows.filter((r) => r.config?.trigger === trigger);
}

/** Sends one push notification to a user. Implemented in `push-server.ts`
 * (Node/web-push only, never bundled into client code) and injected in by
 * server call sites (the reminders cron, the /api/automations/fire route,
 * the Plaud sync job). Client-triggered fire* calls below don't have one to
 * pass, since the actual send has to happen server-side — see fireViaApi. */
export type SendPushFn = (
  supabase: SupabaseClient,
  userId: string,
  payload: { title: string; body: string; url?: string; tag?: string }
) => Promise<void>;

/** Runs every action in a rule against the triggering item. `userId` is
 * needed for send_notification (looks up that user's push subscriptions);
 * pass null to silently skip notification actions (e.g. no session).
 * `sendPush` is likewise required for send_notification actions to actually
 * do anything — omit it to silently skip them (e.g. this call is running in
 * a context with no server-only push sender available). */
export async function runActions(
  supabase: SupabaseClient,
  userId: string | null,
  actions: Action[],
  ctx: RuleContext,
  sendPush?: SendPushFn
) {
  for (const a of actions ?? []) {
    if (a.type === "create_task") {
      const due = new Date(ctx.anchorDate);
      due.setDate(due.getDate() + (a.dueOffsetDays ?? 0));
      await supabase.from("tasks").insert({
        title: fillTemplate(a.title || "{title}", ctx.title),
        due_date: toISODate(due),
        due_kind: "day",
        priority: a.priority ?? 0,
        project: a.project ?? null,
        tags: a.tag ? [a.tag] : undefined,
        shared: false,
      });
    } else if (a.type === "update_item") {
      if (!ctx.entity) continue; // no concrete row to patch (e.g. event triggers)
      const patch: Record<string, unknown> = {};
      if (a.setPriority != null) patch.priority = a.setPriority;
      if (a.setProject) patch.project = a.setProject;
      if (a.setDueOffsetDays != null) {
        const d = new Date();
        d.setDate(d.getDate() + a.setDueOffsetDays);
        patch.due_date = toISODate(d);
      }
      if (a.addTag) {
        const existing = (ctx.tags ?? []).map((t) => t.toLowerCase());
        if (!existing.includes(a.addTag.toLowerCase())) {
          patch.tags = [...(ctx.tags ?? []), a.addTag];
        }
      }
      if (Object.keys(patch).length > 0) {
        await supabase.from(ctx.entity.table).update(patch).eq("id", ctx.entity.id);
      }
    } else if (a.type === "send_notification") {
      if (!userId || !sendPush) continue;
      await sendPush(supabase, userId, {
        title: fillTemplate(a.title || "{title}", ctx.title),
        body: fillTemplate(a.body || "{title}", ctx.title),
        url: "/app",
      });
    } else if (a.type === "create_note") {
      const title = fillTemplate(a.title || "{title}", ctx.title);
      const body = fillTemplate(a.body || "", ctx.title);
      if (a.appendToDaily) {
        const todayStr = toISODate(new Date());
        const { data: existing } = await supabase
          .from("notes")
          .select("id, body")
          .eq("note_date", todayStr)
          .is("deleted_at", null)
          .limit(1)
          .maybeSingle();
        if (existing) {
          const prevBody = (existing as { body?: string | null }).body ?? "";
          await supabase
            .from("notes")
            .update({ body: prevBody ? `${prevBody}\n\n${body}` : body })
            .eq("id", (existing as { id: string }).id);
        } else {
          await supabase.from("notes").insert({ title, body, note_date: todayStr });
        }
      } else {
        await supabase.from("notes").insert({ title, body });
      }
    }
  }
}

/** Core dispatcher — finds every enabled rule for this trigger, checks its
 * conditions against the context, and runs matching rules' actions. */
export async function runTriggerAutomations(
  supabase: SupabaseClient,
  trigger: TriggerType,
  ctx: RuleContext,
  userId?: string | null,
  sendPush?: SendPushFn
) {
  const rules = await rulesForTrigger(supabase, trigger);
  if (rules.length === 0) return;
  let uid = userId ?? null;
  if (uid === undefined) uid = null;
  if (uid === null && userId === undefined) {
    const { data } = await supabase.auth.getUser();
    uid = data.user?.id ?? null;
  }
  for (const r of rules) {
    const cfg = r.config;
    if (!matchesAll(ctx, cfg.conditions)) continue;
    await runActions(supabase, uid, cfg.actions, ctx, sendPush);
  }
}

// ---------------------------------------------------------------------------
// Convenience wrappers for each call site — keep the trigger-specific context
// shape (event/task/note fields) out of the calling components.
//
// The task/event wrappers below run in the browser (Planner.tsx/AgendaView.tsx
// are client components), so they can't execute send_notification actions
// themselves — that needs the server-only `web-push` library. Instead they
// POST the trigger + context to /api/automations/fire, which runs the same
// engine server-side with a real push sender wired in. create_task/
// update_item/create_note actions still end up applied under that request's
// session, same RLS scoping as if the browser had written them directly.

async function fireViaApi(trigger: TriggerType, ctx: RuleContext) {
  try {
    await fetch("/api/automations/fire", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trigger, ctx: { ...ctx, anchorDate: ctx.anchorDate.toISOString() } }),
    });
  } catch {
    // best-effort — a failed automation shouldn't block the user's save
  }
}

export async function fireEventCreated(
  _supabase: SupabaseClient,
  title: string,
  start: Date,
  location?: string | null
) {
  await fireViaApi("event_created", { title, location: location ?? null, anchorDate: start, entity: null });
}

export async function fireEventUpdated(
  _supabase: SupabaseClient,
  title: string,
  start: Date,
  location?: string | null
) {
  await fireViaApi("event_updated", { title, location: location ?? null, anchorDate: start, entity: null });
}

export type TaskLike = {
  id: string;
  title: string;
  project?: string | null;
  tags?: string[] | null;
  priority?: number;
  due_date?: string | null;
};

function taskAnchor(t: TaskLike) {
  return t.due_date ? new Date(`${t.due_date}T00:00:00`) : new Date();
}

export function taskCtx(t: TaskLike): RuleContext {
  return {
    title: t.title,
    project: t.project ?? null,
    tags: t.tags ?? null,
    priority: t.priority ?? 0,
    anchorDate: taskAnchor(t),
    entity: { table: "tasks", id: t.id },
  };
}

export async function fireTaskCreated(_supabase: SupabaseClient, t: TaskLike) {
  const ctx = taskCtx(t);
  await fireViaApi("task_created", ctx);
  await fireViaApi("task_saved", ctx);
}

export async function fireTaskUpdated(_supabase: SupabaseClient, t: TaskLike) {
  const ctx = taskCtx(t);
  await fireViaApi("task_updated", ctx);
  await fireViaApi("task_saved", ctx);
}

export async function fireTaskCompleted(_supabase: SupabaseClient, t: TaskLike) {
  await fireViaApi("task_completed", taskCtx(t));
}

/** Server-side only (called from the Plaud sync job, which runs with a
 * service-role client and no browser to proxy through) — runs the engine
 * directly. Pass `sendPush` (from push-server.ts) so send_notification
 * actions on note_created rules actually fire. */
export async function fireNoteCreated(
  supabase: SupabaseClient,
  note: { title: string; body?: string | null; source?: string | null },
  userId?: string | null,
  sendPush?: SendPushFn
) {
  await runTriggerAutomations(
    supabase,
    "note_created",
    {
      title: note.title,
      body: note.body ?? null,
      source: note.source ?? null,
      anchorDate: new Date(),
      entity: null,
    },
    userId,
    sendPush
  );
}
