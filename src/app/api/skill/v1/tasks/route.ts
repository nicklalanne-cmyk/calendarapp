import { NextResponse, type NextRequest } from "next/server";
import { authenticateApiRequest } from "@/lib/apiAuth";
import { runTriggerAutomations, taskCtx, type TaskLike } from "@/lib/automations";
import { sendPushToUser } from "@/lib/push-server";

const TASK_COLS =
  "id,title,notes,is_done,due_date,due_kind,priority,rrule,repeat,project,location,sort_order,tags,estimate_minutes,parent_id,scheduled_start,scheduled_end,linked_event_id,linked_event_title,created_at";

export async function GET(req: NextRequest) {
  const auth = await authenticateApiRequest(req);
  if (!auth.ok) return auth.response;
  const { db, userId } = auth;

  const { searchParams } = new URL(req.url);
  let q = db.from("tasks").select(TASK_COLS).eq("user_id", userId).is("deleted_at", null);
  const status = searchParams.get("status") ?? "open";
  if (status === "open") q = q.eq("is_done", false);
  if (status === "done") q = q.eq("is_done", true);
  const project = searchParams.get("project");
  if (project) q = q.eq("project", project);
  const search = searchParams.get("search");
  if (search) q = q.ilike("title", `%${search}%`);

  // Nearest-due first, undated tasks last — makes the raw feed usable
  // as-is for an "upcoming tasks" widget without client-side sorting.
  const { data, error } = await q
    .order("due_date", { ascending: true, nullsFirst: false })
    .order("priority", { ascending: false })
    .limit(200);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ tasks: data });
}

export async function POST(req: NextRequest) {
  const auth = await authenticateApiRequest(req);
  if (!auth.ok) return auth.response;
  const { db, userId } = auth;

  const input = await req.json().catch(() => ({}));
  if (!input.title) return NextResponse.json({ error: "title is required" }, { status: 400 });

  const row: Record<string, unknown> = {
    user_id: userId,
    title: input.title,
    due_date: input.due_date ?? null,
    due_kind: input.due_kind ?? "day",
    priority: input.priority ?? 0,
    rrule: input.rrule ?? null,
    project: input.project ?? null,
    location: input.location ?? null,
    tags: input.tags ?? null,
    estimate_minutes: input.estimate_minutes ?? null,
    notes: input.notes ?? null,
    shared: false,
  };
  const { data, error } = await db.from("tasks").insert(row).select(TASK_COLS).single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const ctx = taskCtx(data as TaskLike);
  await runTriggerAutomations(db, "task_created", ctx, userId, sendPushToUser);
  await runTriggerAutomations(db, "task_saved", ctx, userId, sendPushToUser);
  return NextResponse.json({ task: data }, { status: 201 });
}
