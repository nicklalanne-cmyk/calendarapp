import { NextResponse, type NextRequest } from "next/server";
import { authenticateApiRequest } from "@/lib/apiAuth";

const NOTE_COLS = "id,title,body,note_date,task_id,pinned_at,created_at,updated_at,shared";
const EDITABLE_FIELDS = ["title", "body", "note_date", "pinned_at"];

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await authenticateApiRequest(req);
  if (!auth.ok) return auth.response;
  const { db, userId } = auth;

  const input = await req.json().catch(() => ({}));
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const k of EDITABLE_FIELDS) if (k in input) patch[k] = input[k];

  const { data, error } = await db
    .from("notes")
    .update(patch)
    .eq("id", params.id)
    .eq("user_id", userId)
    .select(NOTE_COLS)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ note: data });
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await authenticateApiRequest(req);
  if (!auth.ok) return auth.response;
  const { db, userId } = auth;

  const { error } = await db
    .from("notes")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", params.id)
    .eq("user_id", userId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ deleted: params.id, recoverable: true });
}
