import { NextResponse, type NextRequest } from "next/server";
import { authenticateApiRequest } from "@/lib/apiAuth";

const NOTE_COLS = "id,title,body,note_date,task_id,pinned_at,updated_at,shared";

export async function GET(req: NextRequest) {
  const auth = await authenticateApiRequest(req);
  if (!auth.ok) return auth.response;
  const { db, userId } = auth;

  const { searchParams } = new URL(req.url);
  let q = db.from("notes").select(NOTE_COLS).eq("user_id", userId).is("deleted_at", null);
  const search = searchParams.get("search");
  if (search) q = q.or(`title.ilike.%${search}%,body.ilike.%${search}%`);
  const noteDate = searchParams.get("note_date");
  if (noteDate) q = q.eq("note_date", noteDate);

  const { data, error } = await q.order("updated_at", { ascending: false }).limit(200);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ notes: data });
}

export async function POST(req: NextRequest) {
  const auth = await authenticateApiRequest(req);
  if (!auth.ok) return auth.response;
  const { db, userId } = auth;

  const input = await req.json().catch(() => ({}));
  const row = {
    user_id: userId,
    title: input.title ?? "",
    body: input.body ?? "",
    note_date: input.note_date ?? null,
    shared: false,
  };
  const { data, error } = await db.from("notes").insert(row).select(NOTE_COLS).single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ note: data }, { status: 201 });
}
