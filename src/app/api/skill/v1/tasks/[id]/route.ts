import { NextResponse, type NextRequest } from "next/server";
import { authenticateApiRequest } from "@/lib/apiAuth";

const TASK_COLS =
  "id,title,notes,is_done,due_date,due_kind,priority,rrule,repeat,project,location,sort_order,tags,estimate_minutes,parent_id,scheduled_start,scheduled_end,linked_event_id,linked_event_title,created_at";

const EDITABLE_FIELDS = [
  "title", "due_date", "due_kind", "priority", "rrule",
  "project", "location", "tags", "estimate_minutes", "notes", "is_done",
];

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await authenticateApiRequest(req);
  if (!auth.ok) return auth.response;
  const { db, userId } = auth;

  const input = await req.json().catch(() => ({}));
  const patch: Record<string, unknown> = {};
  for (const k of EDITABLE_FIELDS) if (k in input) patch[k] = input[k];
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  }

  const { data, error } = await db
    .from("tasks")
    .update(patch)
    .eq("id", params.id)
    .eq("user_id", userId)
    .select(TASK_COLS)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ task: data });
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await authenticateApiRequest(req);
  if (!auth.ok) return auth.response;
  const { db, userId } = auth;

  // soft delete, matching the in-app AI Assistant's behavior — recoverable
  const { error } = await db
    .from("tasks")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", params.id)
    .eq("user_id", userId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ deleted: params.id, recoverable: true });
}
