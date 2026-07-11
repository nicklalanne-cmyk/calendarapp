import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/google/session";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MODEL = process.env.CADENCE_AI_MODEL || "claude-sonnet-5";

export async function POST(request: NextRequest) {
  const { user } = await requireUser();
  if (!user) return NextResponse.json({ error: "not_signed_in" }, { status: 401 });

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return NextResponse.json(
      { error: "Add an ANTHROPIC_API_KEY in Vercel to convert handwriting to text." },
      { status: 501 }
    );
  }

  const { image } = (await request.json()) as { image?: string };
  if (!image?.startsWith("data:image/png;base64,")) {
    return NextResponse.json({ error: "no image" }, { status: 400 });
  }
  const b64 = image.slice("data:image/png;base64,".length);

  // ~5MB is the API limit for an inline image
  if (b64.length > 6_500_000) {
    return NextResponse.json(
      { error: "That page is too large to read. Try converting it in sections." },
      { status: 413 }
    );
  }

  const system = `You transcribe handwritten notes into clean markdown.

Rules:
- Transcribe EXACTLY what is written. Never invent, complete, summarise or "improve" the content.
- Preserve structure: headings, bullet lists, numbered lists, checkboxes ([ ] / [x]), indentation, tables.
- Keep names, numbers, prices, addresses and dates verbatim — these are business notes and a wrong digit matters.
- Arrows, boxes and doodles: describe only if they carry meaning, e.g. "→".
- If a word is genuinely illegible, write it as [?] rather than guessing.
- Output ONLY the transcribed markdown. No preamble, no commentary, no code fences.`;

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
        max_tokens: 3000,
        system,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: { type: "base64", media_type: "image/png", data: b64 },
              },
              { type: "text", text: "Transcribe this handwritten page." },
            ],
          },
        ],
      }),
    });

    if (!res.ok) {
      const detail = await res.text();
      return NextResponse.json(
        { error: `Anthropic API ${res.status}`, detail: detail.slice(0, 300) },
        { status: 502 }
      );
    }

    const data = (await res.json()) as { content: { type: string; text?: string }[] };
    const text = data.content
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("")
      .trim();

    return NextResponse.json({ text });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
