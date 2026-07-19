import { NextResponse } from "next/server";
import { requireUser } from "@/lib/google/session";
import { runTriggerAutomations } from "@/lib/automations";
import { sendPushToUser } from "@/lib/push-server";

// User tapping "Add to Tasks" on a detected recurring bill in the Finance
// page. Records it in plaid_bill_reminders too so the automatic hourly/
// webhook-triggered reminder job doesn't create a duplicate for the same
// bill+due-date later.
export async function POST(request: Request) {
  const { supabase, user } = await requireUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const { key, label, amount, due_date, cadence } = body as {
    key?: string;
    label?: string;
    amount?: number;
    due_date?: string;
    cadence?: string;
  };
  if (!key || !label || !due_date) {
    return NextResponse.json({ error: "missing key/label/due_date" }, { status: 400 });
  }

  const { data: task, error } = await supabase
    .from("tasks")
    .insert({
      user_id: user.id,
      title: `Pay ${label}${typeof amount === "number" ? ` (~$${amount.toFixed(2)})` : ""}`,
      due_date,
      due_kind: "day",
      priority: 0,
      notes: `— recurring bill detected from bank transactions${cadence ? `, ${cadence}` : ""}`,
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await runTriggerAutomations(
    supabase,
    "task_created",
    { title: task.title, anchorDate: new Date(`${due_date}T00:00:00`), entity: { table: "tasks", id: task.id } },
    user.id,
    sendPushToUser
  );

  await supabase
    .from("plaid_bill_reminders")
    .upsert({ user_id: user.id, bill_key: key, due_date, task_id: task.id }, { onConflict: "user_id,bill_key,due_date" });

  return NextResponse.json({ ok: true, task });
}
