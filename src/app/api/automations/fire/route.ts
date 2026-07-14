import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { runTriggerAutomations, type TriggerType, type RuleContext } from "@/lib/automations";
import { sendPushToUser } from "@/lib/push-server";

/**
 * Runs the if/then automation engine for a single client-side trigger (event
 * created/updated, task created/updated/completed) using the caller's own
 * session — same RLS scoping as if the browser had written the rows itself.
 * Exists so client components (Planner.tsx, AgendaView.tsx) never need to
 * import the server-only `web-push` dependency to make send_notification
 * actions work.
 */
export async function POST(request: NextRequest) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await request.json();
  const trigger = body?.trigger as TriggerType | undefined;
  const rawCtx = body?.ctx as (Omit<RuleContext, "anchorDate"> & { anchorDate: string }) | undefined;
  if (!trigger || !rawCtx) return NextResponse.json({ error: "missing trigger/ctx" }, { status: 400 });

  const ctx: RuleContext = { ...rawCtx, anchorDate: new Date(rawCtx.anchorDate) };
  await runTriggerAutomations(supabase, trigger, ctx, user.id, sendPushToUser);

  return NextResponse.json({ ok: true });
}
