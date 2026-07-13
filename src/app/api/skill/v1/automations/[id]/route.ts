import { NextResponse, type NextRequest } from "next/server";
import { authenticateApiRequest } from "@/lib/apiAuth";

const EDITABLE_FIELDS = ["name", "kind", "config", "enabled"];

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
    .from("automations")
    .update(patch)
    .eq("id", params.id)
    .eq("user_id", userId)
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ automation: data });
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await authenticateApiRequest(req);
  if (!auth.ok) return auth.response;
  const { db, userId } = auth;

  const { error } = await db.from("automations").delete().eq("id", params.id).eq("user_id", userId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ deleted: params.id });
}
