import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/google/session";

export const dynamic = "force-dynamic";
export const maxDuration = 45;

const MODEL = process.env.CADENCE_AI_MODEL || "claude-sonnet-5";

export type NotePolish = {
  title: string;
  markdown: string;
  tasks: { title: string; due_date?: string | null }[];
};

export async function POST(request: NextRequest) {
  const { user } = await requireUser();
  if (!user) return NextResponse.json({ error: "not_signed_in" }, { status: 401 });

  const { transcript, timezone } = (await request.json()) as {
    transcript?: string;
    timezone?: string;
  };
  const raw = (transcript ?? "").trim();
  if (!raw) return NextResponse.json({ error: "empty transcript" }, { status: 400 });

  const key = process.env.ANTHROPIC_API_KEY;
  // No key? Still useful — hand back the raw dictation untouched.
  if (!key) {
    return NextResponse.json({
      polished: false,
      title: raw.split(/\s+/).slice(0, 7).join(" ") || "Voice memo",
      markdown: raw,
      tasks: [],
    });
  }

  const tz = timezone || "UTC";
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  const system = `You clean up voice dictation into a usable note. Today is ${today} (${tz}).

Return ONLY a JSON object, no prose, no code fences:
{"title": string, "markdown": string, "tasks": [{"title": string, "due_date": "YYYY-MM-DD" | null}]}

- "title": a short, specific title (max 8 words). No date unless the speaker said one.
- "markdown": the dictation cleaned up — fix punctuation, capitalisation and obvious speech-to-text errors, break into paragraphs, use bullets/headings where the speaker was clearly listing things. PRESERVE the speaker's meaning, facts, names and numbers exactly. Do not invent, summarise away, or embellish content. If they rambled, keep the substance but drop filler ("um", "you know", false starts).
- "tasks": any explicit action items or to-dos the speaker committed to ("I need to…", "remind me to…", "follow up with…"). Resolve relative dates against today. Empty array if there are none — do not manufacture tasks.`;

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
      return NextResponse.json({
        polished: false,
        title: "Voice memo",
        markdown: raw,
        tasks: [],
        warning: `Couldn't polish it (${res.status}) — saved the raw transcript. ${detail.slice(0, 120)}`,
      });
    }

    const data = (await res.json()) as { content: { type: string; text?: string }[] };
    const text =
      data.content
        .filter((b) => b.type === "text")
        .map((b) => b.text ?? "")
        .join("")
        .trim() ?? "";

    const jsonStr = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
    const parsed = JSON.parse(jsonStr) as NotePolish;

    return NextResponse.json({
      polished: true,
      title: parsed.title || "Voice memo",
      markdown: parsed.markdown || raw,
      tasks: Array.isArray(parsed.tasks) ? parsed.tasks.slice(0, 10) : [],
    });
  } catch (e) {
    // Never lose the user's words because the model misbehaved.
    return NextResponse.json({
      polished: false,
      title: "Voice memo",
      markdown: raw,
      tasks: [],
      warning: `Saved the raw transcript (${(e as Error).message}).`,
    });
  }
}
