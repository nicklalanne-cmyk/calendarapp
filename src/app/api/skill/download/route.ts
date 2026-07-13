import { NextRequest } from "next/server";

function skillMd(baseUrl: string): string {
  return `---
name: cadence
description: Create, edit, and delete tasks, calendar events, notes, and automations in the user's Cadence app. Use this whenever the user asks to manage their Cadence tasks/calendar/notes/automations from outside the Cadence web app itself.
---

# Cadence

Cadence is the user's personal calendar/task/notes app. This skill lets you read and
write their data directly over HTTPS, so you can help them manage tasks, calendar
events, notes, and automations from any Claude surface (Claude Code, Claude Desktop,
Cowork, claude.ai) — not just inside the Cadence web app.

## Setup (one-time, per environment)

1. In Cadence, go to **Settings → Claude Skill** and click "Generate API key". Copy
   the token shown (it starts with \`cad_live_\` and is only shown once).
2. Make it available to Claude as the environment variable \`CADENCE_API_TOKEN\`
   (e.g. export it in your shell profile, or add it as a secret/env var in whatever
   environment this skill is running in).
3. If the token is ever lost or compromised, generate a new one from the same
   Settings page — this immediately revokes the old one (only one token is live
   per account at a time).

Every request below must include:

\`\`\`
Authorization: Bearer $CADENCE_API_TOKEN
Content-Type: application/json
\`\`\`

Base URL: \`${baseUrl}\`

## What this does NOT cover

Notebooks (freehand handwriting/PDF annotation) aren't exposed — there's nothing
text-editable about a canvas of ink strokes. Everything else a user can do by hand
in Cadence (tasks, calendar events, notes, automations) is available below.

## Tasks

- \`GET /api/skill/v1/tasks?status=open|done&project=<name>&search=<text>\` — list tasks.
- \`POST /api/skill/v1/tasks\` — create a task. Body: \`{ title, due_date?, due_kind?: "day"|"week", priority?: 0-3, rrule?, project?, location?, tags?: string[], estimate_minutes?, notes? }\`.
- \`PATCH /api/skill/v1/tasks/:id\` — update any of the same fields, plus \`is_done\`.
- \`DELETE /api/skill/v1/tasks/:id\` — soft-deletes (recoverable) a task.

## Calendar events

Reads/writes the user's connected Google Calendar(s) directly.

- \`GET /api/skill/v1/events?timeMin=<ISO>&timeMax=<ISO>\` — list events in a range across all connected accounts/calendars.
- \`POST /api/skill/v1/events\` — create an event. Body: \`{ title, start, end, accountId?, calendarId? (default "primary"), location?, description?, recurrence?: string[] }\`. \`start\`/\`end\` are ISO datetimes.
- \`PATCH /api/skill/v1/events/:id?accountId=<id>&calendarId=<id>\` — update title/start/end/location/description. \`accountId\` is required (get it from a prior \`GET /events\` response — each event includes \`accountId\`/\`calendarId\`).
- \`DELETE /api/skill/v1/events/:id?accountId=<id>&calendarId=<id>\` — delete an event.

## Notes

- \`GET /api/skill/v1/notes?search=<text>&note_date=<yyyy-mm-dd>\` — list notes.
- \`POST /api/skill/v1/notes\` — create a note. Body: \`{ title?, body?, note_date? }\`.
- \`PATCH /api/skill/v1/notes/:id\` — update \`title\`/\`body\`/\`note_date\`/\`pinned_at\`.
- \`DELETE /api/skill/v1/notes/:id\` — soft-deletes (recoverable) a note.

## Automations

Rules that run automatically inside Cadence (recurring tasks, follow-ups, prep
tasks before events, due-soon nudges, and conditional tag/project → priority
updates). Prefer creating one of these over doing a repeated action manually when
the user describes an ongoing behavior they want.

- \`GET /api/skill/v1/automations\` — list all automations.
- \`POST /api/skill/v1/automations\` — create one. Body: \`{ name, kind, config, enabled? }\` where \`kind\` is one of \`recurring_task\` | \`task_completed_followup\` | \`event_prep_task\` | \`due_soon_nudge\` | \`conditional_update\`, and \`config\` matches that kind:
  - \`recurring_task\`: \`{ title, daysOfWeek: number[] (0=Sun..6=Sat), project?, priority? }\`
  - \`task_completed_followup\`: \`{ filter?, title, dueOffsetDays, project?, priority? }\`
  - \`event_prep_task\`: \`{ title, hoursBefore, project?, priority? }\`
  - \`due_soon_nudge\`: \`{ daysBefore }\`
  - \`conditional_update\`: \`{ matchField: "tag"|"project", matchValue, setPriority?, setProject?, addTag? }\`
- \`PATCH /api/skill/v1/automations/:id\` — update \`name\`/\`kind\`/\`config\`/\`enabled\`.
- \`DELETE /api/skill/v1/automations/:id\` — permanently deletes the automation.

## Conventions

- All responses are JSON. Errors are \`{ "error": "message" }\` with a non-2xx status.
- \`priority\` is \`0\` (none) through \`3\` (highest) — mirrors the app's flag colors.
- Dates are \`yyyy-mm-dd\`; datetimes are ISO 8601.
- Be brief when confirming what you did — one or two sentences, no bulleted recaps,
  matching how Cadence's own in-app AI Assistant behaves.
`;
}

export async function GET(req: NextRequest) {
  const baseUrl = req.nextUrl.origin;
  const body = skillMd(baseUrl);
  return new Response(body, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": 'attachment; filename="SKILL.md"',
    },
  });
}
