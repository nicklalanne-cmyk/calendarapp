import { NextResponse, type NextRequest } from "next/server";
import { authenticateApiRequest } from "@/lib/apiAuth";

const NOTE_COLS = "id,title,body,note_date,task_id,pinned_at,updated_at,shared";
const SOURCE = "voice-daily";

/** "2026-07-14" -> "Tuesday, 7/14 Thoughts". Parsed as UTC noon so the local
 * calendar date the caller sent isn't shifted by a day depending on server TZ. */
function titleForDate(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00Z`);
  const weekday = d.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
  const month = d.toLocaleDateString("en-US", { month: "numeric", timeZone: "UTC" });
  const day = d.toLocaleDateString("en-US", { day: "numeric", timeZone: "UTC" });
  return `${weekday}, ${month}/${day} Thoughts`;
}

/**
 * Appends a piece of dictated text onto a single running "<Weekday>, M/D
 * Thoughts" note for the given local date — creating it on first use that
 * day, appending to it every call after. Built for the "Cadence Voice Note"
 * iOS Shortcut, which sends whatever date the phone thinks it is locally
 * (avoids server-timezone guesswork about what day it "actually" is).
 */
export async function POST(req: NextRequest) {
  const auth = await authenticateApiRequest(req);
  if (!auth.ok) return auth.response;
  const { db, userId } = auth;

  const input = await req.json().catch(() => ({}));
  const noteDate = typeof input.note_date === "string" ? input.note_date : null;
  const text = typeof input.text === "string" ? input.text.trim() : "";
  if (!noteDate || !/^\d{4}-\d{2}-\d{2}$/.test(noteDate)) {
    return NextResponse.json({ error: "note_date is required as YYYY-MM-DD" }, { status: 400 });
  }
  if (!text) return NextResponse.json({ error: "text is required" }, { status: 400 });

  const title = titleForDate(noteDate);
  const stamp = new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

  const { data: existing, error: findErr } = await db
    .from("notes")
    .select(NOTE_COLS)
    .eq("user_id", userId)
    .eq("note_date", noteDate)
    .eq("source", SOURCE)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (findErr) return NextResponse.json({ error: findErr.message }, { status: 500 });

  const entry = `[${stamp}] ${text}`;

  if (existing) {
    const body = existing.body ? `${existing.body}\n\n${entry}` : entry;
    const { data, error } = await db
      .from("notes")
      .update({ body, title, updated_at: new Date().toISOString() })
      .eq("id", existing.id)
      .eq("user_id", userId)
      .select(NOTE_COLS)
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ note: data, appended: true });
  }

  const { data, error } = await db
    .from("notes")
    .insert({ user_id: userId, title, note_date: noteDate, body: entry, source: SOURCE, shared: false })
    .select(NOTE_COLS)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ note: data, appended: false }, { status: 201 });
}
