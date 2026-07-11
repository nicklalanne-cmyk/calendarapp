import { NextResponse, type NextRequest } from "next/server";
import { requireUser, type GoogleAccountRow } from "@/lib/google/session";
import { getGoogleAccessToken } from "@/lib/google/tokens";
import {
  listCalendars,
  listEventsRaw,
  createEventRaw,
  updateEventRaw,
  deleteEventRaw,
  mapEvent,
} from "@/lib/google/calendar";
import type { CalendarEvent } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MODEL = process.env.CADENCE_AI_MODEL || "claude-sonnet-5";
const API = "https://api.anthropic.com/v1/messages";
const MAX_TURNS = 8;

type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };

type Msg = { role: "user" | "assistant"; content: string | ContentBlock[] };

const TOOLS = [
  {
    name: "list_tasks",
    description:
      "List the user's tasks. Use this before updating or deleting so you have real task ids. Returns id, title, due_date, due_kind, priority, rrule, project, tags, estimate_minutes, is_done.",
    input_schema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["open", "done", "all"], description: "Default: open." },
        project: { type: "string", description: "Only tasks in this project." },
        search: { type: "string", description: "Case-insensitive substring match on the title." },
      },
    },
  },
  {
    name: "create_task",
    description: "Create a task.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        due_date: {
          type: "string",
          description:
            "YYYY-MM-DD. If due_kind is 'week', this must be the SUNDAY that starts the week.",
        },
        due_kind: {
          type: "string",
          enum: ["day", "week"],
          description: "'week' means the task is due some time that week rather than on a day.",
        },
        priority: { type: "number", description: "0 = none, 1 = highest … 4 = lowest." },
        rrule: {
          type: "string",
          description:
            "Recurrence, RRULE subset. Examples: 'FREQ=DAILY;INTERVAL=1'; 'FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,WE,FR'; every other Thursday = 'FREQ=WEEKLY;INTERVAL=2;BYDAY=TH'; first Thursday of the month = 'FREQ=MONTHLY;INTERVAL=1;BYDAY=1TH'; last Friday = 'FREQ=MONTHLY;INTERVAL=1;BYDAY=-1FR'; the 15th monthly = 'FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=15'.",
        },
        project: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
        estimate_minutes: { type: "number" },
        notes: { type: "string" },
      },
      required: ["title"],
    },
  },
  {
    name: "update_task",
    description: "Update fields on an existing task. Only pass the fields you want to change.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string" },
        title: { type: "string" },
        due_date: { type: "string", description: "YYYY-MM-DD, or null to clear." },
        due_kind: { type: "string", enum: ["day", "week"] },
        priority: { type: "number" },
        rrule: { type: "string", description: "Or null to stop repeating." },
        project: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
        estimate_minutes: { type: "number" },
        notes: { type: "string" },
        is_done: { type: "boolean" },
      },
      required: ["id"],
    },
  },
  {
    name: "delete_task",
    description: "Delete a task permanently. Confirm with the user first if it is at all ambiguous.",
    input_schema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },
  {
    name: "list_events",
    description:
      "List calendar events in a time range. Returns id, title, start, end, accountId and calendarId — you need accountId and calendarId to update or delete an event.",
    input_schema: {
      type: "object",
      properties: {
        timeMin: { type: "string", description: "ISO 8601 datetime." },
        timeMax: { type: "string", description: "ISO 8601 datetime." },
      },
      required: ["timeMin", "timeMax"],
    },
  },
  {
    name: "create_event",
    description: "Create a calendar event on the user's default Google calendar.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        start: { type: "string", description: "ISO 8601 datetime with offset." },
        end: { type: "string", description: "ISO 8601 datetime with offset." },
        location: { type: "string" },
        description: { type: "string" },
        recurrence: {
          type: "array",
          items: { type: "string" },
          description: "Optional RRULE lines, e.g. ['RRULE:FREQ=WEEKLY;BYDAY=TU'].",
        },
      },
      required: ["title", "start", "end"],
    },
  },
  {
    name: "update_event",
    description: "Move or edit an existing calendar event. Get ids from list_events first.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string" },
        accountId: { type: "string" },
        calendarId: { type: "string" },
        title: { type: "string" },
        start: { type: "string" },
        end: { type: "string" },
        location: { type: "string" },
        description: { type: "string" },
      },
      required: ["id", "accountId", "calendarId"],
    },
  },
  {
    name: "delete_event",
    description: "Delete a calendar event. Get ids from list_events first.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string" },
        accountId: { type: "string" },
        calendarId: { type: "string" },
      },
      required: ["id", "accountId", "calendarId"],
    },
  },
];

export async function POST(request: NextRequest) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return NextResponse.json(
      {
        error:
          "The assistant isn't configured yet — add an ANTHROPIC_API_KEY environment variable in Vercel and redeploy.",
      },
      { status: 501 }
    );
  }

  const { supabase, user } = await requireUser();
  if (!user) return NextResponse.json({ error: "not_signed_in" }, { status: 401 });

  const body = (await request.json()) as { messages?: Msg[]; timezone?: string };
  const messages: Msg[] = body.messages ?? [];
  if (messages.length === 0) {
    return NextResponse.json({ error: "no messages" }, { status: 400 });
  }

  const tz = body.timezone || "UTC";
  const now = new Date();
  const todayLocal = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const weekdayLocal = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "long",
  }).format(now);

  const system = `You are Cadence's built-in assistant. You manage the user's tasks and calendar by calling tools.

Today is ${weekdayLocal}, ${todayLocal}. The user's timezone is ${tz}. The current time is ${now.toISOString()}.

Rules:
- Prefer doing over asking. If a request is clear, just call the tools and report what you did.
- Resolve relative dates yourself ("tomorrow", "next Tuesday") against today's date above.
- Before you update or delete anything, call the matching list_ tool so you're acting on a real id — never guess an id.
- Deleting is permanent. If more than one item could match, ask which one instead of guessing.
- When creating events, always include a timezone offset in the ISO datetimes.
- Default an event to 1 hour if the user doesn't give a duration.
- Be brief. Confirm what changed in one or two sentences — no bulleted recaps.`;

  // ---- tool implementations -------------------------------------------------

  const accountsOf = async (): Promise<GoogleAccountRow[]> => {
    const { data } = await supabase.from("google_accounts").select("*");
    return (data as GoogleAccountRow[] | null) ?? [];
  };

  const TASK_COLS =
    "id,title,notes,is_done,due_date,due_kind,priority,rrule,repeat,project,tags,estimate_minutes,parent_id";

  const mutated = { tasks: false, events: false };

  async function runTool(name: string, input: Record<string, any>): Promise<unknown> {
    switch (name) {
      case "list_tasks": {
        let q = supabase.from("tasks").select(TASK_COLS).is("deleted_at", null);
        const status = (input.status as string) ?? "open";
        if (status === "open") q = q.eq("is_done", false);
        if (status === "done") q = q.eq("is_done", true);
        if (input.project) q = q.eq("project", input.project);
        if (input.search) q = q.ilike("title", `%${input.search}%`);
        const { data, error } = await q.limit(200);
        if (error) throw new Error(error.message);
        return data;
      }
      case "create_task": {
        const row: Record<string, unknown> = {
          title: input.title,
          due_date: input.due_date ?? null,
          due_kind: input.due_kind ?? "day",
          priority: input.priority ?? 0,
          rrule: input.rrule ?? null,
          project: input.project ?? null,
          tags: input.tags ?? null,
          estimate_minutes: input.estimate_minutes ?? null,
          notes: input.notes ?? null,
        };
        const { data, error } = await supabase.from("tasks").insert(row).select(TASK_COLS).single();
        if (error) throw new Error(error.message);
        mutated.tasks = true;
        return data;
      }
      case "update_task": {
        const { id, ...rest } = input;
        const patch: Record<string, unknown> = {};
        for (const k of [
          "title", "due_date", "due_kind", "priority", "rrule",
          "project", "tags", "estimate_minutes", "notes", "is_done",
        ]) {
          if (k in rest) patch[k] = rest[k];
        }
        if (Object.keys(patch).length === 0) throw new Error("nothing to update");
        const { data, error } = await supabase
          .from("tasks").update(patch).eq("id", id).select(TASK_COLS).single();
        if (error) throw new Error(error.message);
        mutated.tasks = true;
        return data;
      }
      case "delete_task": {
        // soft delete, so the user can still undo something the assistant removed
        const { error } = await supabase
          .from("tasks")
          .update({ deleted_at: new Date().toISOString() })
          .eq("id", input.id);
        if (error) throw new Error(error.message);
        mutated.tasks = true;
        return { deleted: input.id, recoverable: true };
      }
      case "list_events": {
        const accounts = await accountsOf();
        if (accounts.length === 0) return { events: [], note: "No Google account connected." };
        const all: CalendarEvent[] = [];
        await Promise.all(
          accounts.map(async (acc) => {
            const token = await getGoogleAccessToken(acc.refresh_token);
            if (!token) return;
            const cals = await listCalendars(token);
            await Promise.all(
              cals
                .filter((c) => c.selected !== false)
                .map(async (cal) => {
                  try {
                    const raw = await listEventsRaw(token, cal.id, input.timeMin, input.timeMax);
                    for (const e of raw) {
                      all.push(
                        mapEvent(e, {
                          accountId: acc.id,
                          accountEmail: acc.google_email,
                          calendarId: cal.id,
                          color: cal.backgroundColor,
                        })
                      );
                    }
                  } catch {
                    /* skip calendar */
                  }
                })
            );
          })
        );
        return all
          .sort((a, b) => a.start.localeCompare(b.start))
          .map((e) => ({
            id: e.id, title: e.title, start: e.start, end: e.end, allDay: e.allDay,
            location: e.location, accountId: e.accountId, calendarId: e.calendarId,
          }));
      }
      case "create_event": {
        const accounts = await accountsOf();
        if (accounts.length === 0) throw new Error("No Google account connected.");
        const target = accounts.find((a) => a.is_default) ?? accounts[0];
        const token = await getGoogleAccessToken(target.refresh_token);
        if (!token) throw new Error("Could not refresh the Google token.");
        const e = await createEventRaw(token, "primary", {
          title: input.title,
          start: input.start,
          end: input.end,
          location: input.location ?? null,
          description: input.description ?? null,
          recurrence: input.recurrence ?? null,
        });
        mutated.events = true;
        return mapEvent(e, {
          accountId: target.id,
          accountEmail: target.google_email,
          calendarId: "primary",
          color: null,
        });
      }
      case "update_event": {
        const accounts = await accountsOf();
        const acc = accounts.find((a) => a.id === input.accountId);
        if (!acc) throw new Error("Unknown accountId.");
        const token = await getGoogleAccessToken(acc.refresh_token);
        if (!token) throw new Error("Could not refresh the Google token.");
        const patch: Record<string, unknown> = {};
        for (const k of ["title", "start", "end", "location", "description"]) {
          if (k in input) patch[k] = input[k];
        }
        const e = await updateEventRaw(token, input.calendarId, input.id, patch);
        mutated.events = true;
        return mapEvent(e, {
          accountId: acc.id,
          accountEmail: acc.google_email,
          calendarId: input.calendarId,
          color: null,
        });
      }
      case "delete_event": {
        const accounts = await accountsOf();
        const acc = accounts.find((a) => a.id === input.accountId);
        if (!acc) throw new Error("Unknown accountId.");
        const token = await getGoogleAccessToken(acc.refresh_token);
        if (!token) throw new Error("Could not refresh the Google token.");
        await deleteEventRaw(token, input.calendarId, input.id);
        mutated.events = true;
        return { deleted: input.id };
      }
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }

  // ---- agentic loop ---------------------------------------------------------

  const convo: Msg[] = [...messages];

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const res = await fetch(API, {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1500,
        system,
        tools: TOOLS,
        messages: convo,
      }),
    });

    if (!res.ok) {
      const detail = await res.text();
      return NextResponse.json(
        { error: `Anthropic API ${res.status}`, detail: detail.slice(0, 500) },
        { status: 502 }
      );
    }

    const data = (await res.json()) as {
      content: ContentBlock[];
      stop_reason: string;
    };

    convo.push({ role: "assistant", content: data.content });

    if (data.stop_reason !== "tool_use") {
      const text = data.content
        .filter((b): b is { type: "text"; text: string } => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      return NextResponse.json({
        reply: text || "Done.",
        mutated,
        messages: convo,
      });
    }

    const results: ContentBlock[] = [];
    for (const block of data.content) {
      if (block.type !== "tool_use") continue;
      try {
        const out = await runTool(block.name, block.input);
        results.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: JSON.stringify(out ?? null).slice(0, 20000),
        });
      } catch (err) {
        results.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: `Error: ${(err as Error).message}`,
          is_error: true,
        });
      }
    }
    convo.push({ role: "user", content: results });
  }

  return NextResponse.json(
    { reply: "I got stuck in a loop working on that — try narrowing the request.", mutated },
    { status: 200 }
  );
}
