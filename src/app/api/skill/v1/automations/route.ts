import { NextResponse, type NextRequest } from "next/server";
import { authenticateApiRequest } from "@/lib/apiAuth";

// `kind` is always "rule" — automations are generic if/then rules now. See
// src/lib/automations.ts for the RuleConfig shape (trigger, conditions,
// actions, plus daysOfWeek/daysOffset for schedule/date-relative triggers).

export async function GET(req: NextRequest) {
  const auth = await authenticateApiRequest(req);
  if (!auth.ok) return auth.response;
  const { db, userId } = auth;

  const { data, error } = await db
    .from("automations")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ automations: data });
}

export async function POST(req: NextRequest) {
  const auth = await authenticateApiRequest(req);
  if (!auth.ok) return auth.response;
  const { db, userId } = auth;

  const input = await req.json().catch(() => ({}));
  if (!input.name || !input.kind || !input.config) {
    return NextResponse.json({ error: "name, kind, and config are required" }, { status: 400 });
  }
  const row = {
    user_id: userId,
    name: input.name,
    kind: input.kind,
    config: input.config,
    enabled: input.enabled ?? true,
  };
  const { data, error } = await db.from("automations").insert(row).select("*").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ automation: data }, { status: 201 });
}
