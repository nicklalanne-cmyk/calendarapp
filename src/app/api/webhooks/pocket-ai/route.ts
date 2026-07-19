import { NextResponse, type NextRequest } from "next/server";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";
import type { GoogleAccountRow } from "@/lib/google/session";
import { getGoogleAccessToken } from "@/lib/google/tokens";
import { createEventRaw } from "@/lib/google/calendar";
import { fireNoteCreated, runTriggerAutomations } from "@/lib/automations";
import { sendPushToUser } from "@/lib/push-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const MODEL = process.env.CADENCE_AI_MODEL || "claude-sonnet-5";

// summary.completed carries the fullest content (summary + action items +
// transcript), but that post-processing step is Pro-only — on a free Pocket
// account a recording only ever fires transcription.completed, with no
// `summarizations` in the payload at all. Act on either: the content-builder
// below already treats summary/action items as optional and falls back to
// transcript alone. recording_id dedup means if a recording somehow fires
// both (e.g. after a plan upgrade), only the first one to arrive does
// anything. Everything else (recording.created, transcript.edited, the
// various *.regenerated events, ...) gets a 200 with `ignored: true` so
// Pocket doesn't retry it as a failure.
const ACTIONABLE_EVENTS = new Set(["summary.completed", "transcription.completed"]);

type PocketWebhookPayload = {
  event: string;
  recording: { id: string; title?: string; description?: string; createdAt?: string };
  summarizations?: Record<
    string,
    {
      v2?: {
        summary?: { title?: string; markdown?: string; bulletPoints?: string[] };
        actionItems?: { actionItems?: { title: string; dueDate?: string | null }[] };
      };
    }
  >;
  transcript?: { speaker?: string; text: string }[];
};

type TriagedItem =
  | { type: "task"; title: string; due_date: string | null }
  | { type: "event"; title: string; date: string; start_time: string; end_time: string; location: string | null }
  | { type: "note"; title: string; body: string };

/** Converts a local wall-clock time in an arbitrary IANA zone to a UTC ISO
 * string without a timezone library — the standard "guess with UTC, read
 * back what that instant looks like in the target zone, correct by the
 * difference" trick. Accurate outside DST-transition edge cases, which is
 * fine for a voice-memo's rough scheduling intent. */
function zonedTimeToUtcISO(dateStr: string, timeStr: string, timeZone: string): string {
  const guess = new Date(`${dateStr}T${timeStr}:00Z`);
  const asZoned = new Date(guess.toLocaleString("en-US", { timeZone }));
  const asUTC = new Date(guess.toLocaleString("en-US", { timeZone: "UTC" }));
  const diff = asUTC.getTime() - asZoned.getTime();
  return new Date(guess.getTime() + diff).toISOString();
}

function verifySignature(secret: string, timestamp: string, rawBody: string, signature: string): boolean {
  try {
    const expected = crypto.createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return NextResponse.json({ error: "not_configured" }, { status: 501 });
  }
  const db = createClient(url, serviceKey, { auth: { persistSession: false } });

  // Single-tenant for now — one Pocket AI account, Nick's. If this ever
  // needs to support more than one connected account, this is where to
  // switch to matching payload.user.email against a per-user row.
  const { data: acct } = await db.from("pocket_ai_account").select("*").limit(1).maybeSingle();
  if (!acct) return NextResponse.json({ error: "not_connected" }, { status: 501 });
  if (!acct.webhook_secret) {
    // Bootstrapping: the webhook was added in Pocket's UI but the signing
    // secret hasn't been stored here yet. Refuse to act on unverified
    // payloads rather than silently trusting anyone who can POST this URL.
    return NextResponse.json({ error: "webhook_secret_not_set" }, { status: 501 });
  }

  const rawBody = await request.text();
  const signature = request.headers.get("x-heypocket-signature") ?? "";
  const timestamp = request.headers.get("x-heypocket-timestamp") ?? "";
  if (!signature || !timestamp || !verifySignature(acct.webhook_secret, timestamp, rawBody, signature)) {
    return NextResponse.json({ error: "bad_signature" }, { status: 401 });
  }

  let payload: PocketWebhookPayload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }

  if (!ACTIONABLE_EVENTS.has(payload.event)) {
    return NextResponse.json({ ignored: true, event: payload.event });
  }

  const recordingId = payload.recording?.id;
  if (!recordingId) return NextResponse.json({ error: "missing_recording_id" }, { status: 400 });

  const { data: already } = await db
    .from("pocket_ai_processed")
    .select("recording_id")
    .eq("recording_id", recordingId)
    .maybeSingle();
  if (already) return NextResponse.json({ ok: true, deduped: true });

  const userId: string = acct.user_id;

  const { data: settingsRow } = await db
    .from("user_settings")
    .select("timezone")
    .eq("user_id", userId)
    .maybeSingle();
  const tz = settingsRow?.timezone || "America/New_York";

  const sum = Object.values(payload.summarizations ?? {})[0]?.v2;
  const summaryMarkdown = sum?.summary?.markdown ?? "";
  const bulletPoints = sum?.summary?.bulletPoints ?? [];
  const actionItems = sum?.actionItems?.actionItems ?? [];
  const transcriptText = (payload.transcript ?? [])
    .map((t) => (t.speaker ? `${t.speaker}: ${t.text}` : t.text))
    .join("\n")
    .slice(0, 8000);

  const content = [
    `Recording title: ${payload.recording?.title ?? "(untitled)"}`,
    payload.recording?.description ? `Description: ${payload.recording.description}` : "",
    summaryMarkdown ? `\nSummary:\n${summaryMarkdown}` : "",
    bulletPoints.length ? `\nKey points:\n${bulletPoints.map((b) => `- ${b}`).join("\n")}` : "",
    actionItems.length
      ? `\nExisting action items (already extracted by Pocket, use as a starting point):\n${actionItems
          .map((a) => `- ${a.title}${a.dueDate ? ` (due ${a.dueDate})` : ""}`)
          .join("\n")}`
      : "",
    transcriptText ? `\nTranscript:\n${transcriptText}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return NextResponse.json({ error: "no_ai_key" }, { status: 501 });

  const now = new Date();
  const todayLocal = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);

  const system = `You triage a voice recording for a personal planner app called Cadence into whatever Cadence items it's actually worth creating. Today is ${todayLocal} (${tz}).

Rules:
- A "task" is anything actionable with no fixed calendar time (a to-do, a reminder, a follow-up). due_date is "YYYY-MM-DD" if the speaker mentioned a specific day, otherwise null. Never guess a time for a task.
- An "event" is ONLY for something with an explicit date AND a specific time — an appointment, a call, a meeting. date is "YYYY-MM-DD", start_time/end_time are "HH:mm" 24-hour in the user's local time. If no end/duration was mentioned, default end_time to 30 minutes after start_time. Only emit an event if you're confident about both the date and the time — if unsure, make it a task instead.
- A "note" is anything worth remembering that isn't a task or event — an idea, a reflection, information to keep. title + a cleaned-up markdown body (fix punctuation/structure, preserve the speaker's actual content and facts, don't invent or embellish). If the whole recording is just a thought with nothing actionable, that's exactly one note using the summary as the body.
- Prefer fewer, more useful items over one per sentence — a typical recording needs 0-3 tasks and at most one note, rarely an event. Use the existing action items as a starting point but merge/drop/add based on the transcript.
- If there's genuinely nothing worth saving (silence, a test recording, pure filler), return an empty items array.

Return ONLY a JSON object, no prose, no code fences:
{"items": [
  {"type": "task", "title": string, "due_date": "YYYY-MM-DD" | null},
  {"type": "event", "title": string, "date": "YYYY-MM-DD", "start_time": "HH:mm", "end_time": "HH:mm", "location": string | null},
  {"type": "note", "title": string, "body": string}
]}`;

  let items: TriagedItem[] = [];
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2000,
        system,
        messages: [{ role: "user", content }],
      }),
    });
    if (!res.ok) throw new Error(`anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = (await res.json()) as { content: { type: string; text?: string }[] };
    const text = data.content
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("")
      .trim();
    const jsonStr = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
    const parsed = JSON.parse(jsonStr) as { items?: TriagedItem[] };
    items = Array.isArray(parsed.items) ? parsed.items : [];
  } catch (e) {
    return NextResponse.json({ error: `classification_failed: ${(e as Error).message}` }, { status: 502 });
  }

  const created: { type: string; title: string }[] = [];
  const sourceNote = `\n\n— from a Pocket AI recording: "${payload.recording?.title ?? recordingId}"`;

  for (const item of items) {
    try {
      if (item.type === "task") {
        const { data: row, error } = await db
          .from("tasks")
          .insert({
            user_id: userId,
            title: item.title,
            due_date: item.due_date,
            due_kind: "day",
            priority: 0,
            notes: sourceNote.trim(),
          })
          .select()
          .single();
        if (error) throw new Error(error.message);
        await runTriggerAutomations(
          db,
          "task_created",
          { title: item.title, anchorDate: item.due_date ? new Date(`${item.due_date}T00:00:00`) : now, entity: { table: "tasks", id: row.id } },
          userId,
          sendPushToUser
        );
        created.push({ type: "task", title: item.title });
      } else if (item.type === "note") {
        const body = `${item.body}${sourceNote}`;
        const { error } = await db.from("notes").insert({
          user_id: userId,
          title: item.title,
          body,
          note_date: todayLocal,
          shared: false,
          source: "pocket_ai",
        });
        if (error) throw new Error(error.message);
        await fireNoteCreated(db, { title: item.title, body, source: "pocket_ai" }, userId, sendPushToUser);
        created.push({ type: "note", title: item.title });
      } else if (item.type === "event") {
        const { data: accounts } = await db.from("google_accounts").select("*").eq("user_id", userId);
        const rows = (accounts as GoogleAccountRow[] | null) ?? [];
        const target = rows.find((a) => a.is_default) || rows[0];
        if (!target) throw new Error("no Google account connected");
        const token = await getGoogleAccessToken(target.refresh_token);
        if (!token) throw new Error("Google token refresh failed");
        const startISO = zonedTimeToUtcISO(item.date, item.start_time, tz);
        const endISO = zonedTimeToUtcISO(item.date, item.end_time, tz);
        await createEventRaw(token, "primary", {
          title: item.title,
          start: startISO,
          end: endISO,
          allDay: false,
          location: item.location ?? null,
          description: sourceNote.trim(),
        });
        created.push({ type: "event", title: item.title });
      }
    } catch (e) {
      created.push({ type: `${item.type}_failed`, title: `${item.title}: ${(e as Error).message}` });
    }
  }

  await db.from("pocket_ai_processed").insert({
    recording_id: recordingId,
    user_id: userId,
    event: payload.event,
    created_items: created,
  });

  if (created.length > 0) {
    await sendPushToUser(db, userId, {
      title: "Pocket AI recording processed",
      body:
        created.length === 1
          ? `Added 1 ${created[0].type}: ${created[0].title}`
          : `Added ${created.length} items from "${payload.recording?.title ?? "a recording"}"`,
      url: "/app",
      tag: "pocket-ai",
    });
  }

  return NextResponse.json({ ok: true, created });
}
