import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/google/session";

export const dynamic = "force-dynamic";
export const maxDuration = 45;

const MODEL = process.env.CADENCE_AI_MODEL || "claude-sonnet-5";

// "Claude Clean Up" — rewrites a note's body (used for Plaud notes, which
// start life as a raw AI summary + transcript excerpt) into something more
// pleasant to actually read, without inventing or dropping any content.
export async function POST(request: NextRequest) {
  const { supabase, user } = await requireUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { noteId } = (await request.json().catch(() => ({}))) as { noteId?: string };
  if (!noteId) return NextResponse.json({ error: "noteId required" }, { status: 400 });

  const { data: note, error: fetchError } = await supabase
    .from("notes")
    .select("id,body,title")
    .eq("id", noteId)
    .eq("user_id", user.id)
    .single();
  if (fetchError || !note) return NextResponse.json({ error: "Note not found" }, { status: 404 });

  const raw = (note.body ?? "").trim();
  if (!raw) return NextResponse.json({ error: "Note is empty" }, { status: 400 });

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return NextResponse.json({ error: "Clean-up isn't configured (missing ANTHROPIC_API_KEY)." }, { status: 501 });
  }

  const system = `You clean up a note for easier reading. The note usually mixes an AI-generated
summary of a recording with a raw transcript excerpt underneath a "---" divider.

Rewrite it into a single clear, well-organized markdown note:
- Lead with the substance (what happened / what was discussed / decisions / action items),
  organized with short headings or bullets where that helps.
- Fold in any concrete details from the transcript excerpt that aren't already covered by the
  summary (names, numbers, specific commitments) — don't just repeat the summary and then
  separately repeat the transcript.
- Preserve all facts, names, and numbers exactly. Do not invent, embellish, or drop content.
- Keep it reasonably concise — this is a cleanup pass, not an expansion.

Return ONLY the cleaned-up markdown. No preamble, no code fences, no commentary about what you did.`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2000,
        system,
        messages: [{ role: "user", content: raw }],
      }),
    });

    if (!res.ok) {
      const detail = await res.text();
      return NextResponse.json(
        { error: `Clean-up failed (${res.status}): ${detail.slice(0, 200)}` },
        { status: 502 }
      );
    }

    const data = (await res.json()) as { content: { type: string; text?: string }[] };
    const cleaned = data.content
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("")
      .trim();
    if (!cleaned) return NextResponse.json({ error: "Clean-up returned nothing" }, { status: 502 });

    const { error: updateError } = await supabase
      .from("notes")
      .update({ body: cleaned, updated_at: new Date().toISOString() })
      .eq("id", noteId)
      .eq("user_id", user.id);
    if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

    return NextResponse.json({ body: cleaned });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
