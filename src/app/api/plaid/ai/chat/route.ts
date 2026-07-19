import { NextResponse } from "next/server";
import { requireUser } from "@/lib/google/session";
import { getFinanceAiApiKey, buildFinanceContext, askFinancialAssistant } from "@/lib/financeAi";

export const maxDuration = 60;

// Financial Planner chat assistant. Not persisted server-side — the client
// keeps the message history in memory and resends it each turn (same
// pattern as a stateless chat completion call). Context is rebuilt fresh
// from the user's own RLS-scoped data on every request, so it's always
// current with whatever just synced.
export async function POST(request: Request) {
  const { supabase, user } = await requireUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const apiKey = await getFinanceAiApiKey(supabase, user.id);
  if (!apiKey) {
    return NextResponse.json({ error: "No AI assistant key configured yet" }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));
  const messages = (body.messages ?? []) as { role: "user" | "assistant"; content: string }[];
  if (!Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json({ error: "messages required" }, { status: 400 });
  }

  try {
    const context = await buildFinanceContext(supabase, user.id);
    const reply = await askFinancialAssistant(apiKey, context, messages.slice(-20));
    return NextResponse.json({ reply });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
