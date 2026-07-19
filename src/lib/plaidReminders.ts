import type { SupabaseClient } from "@supabase/supabase-js";
import { detectRecurringBills } from "@/lib/plaid";
import { runTriggerAutomations } from "@/lib/automations";
import { sendPushToUser } from "@/lib/push-server";

/**
 * Server-only (pulls in push-server's Node-only `web-push` transitively via
 * sendPushToUser) — never import this from a client component. Checks
 * whether any detected recurring bill is due within the next 3 days and, if
 * we haven't already reminded about that exact bill+due-date before
 * (plaid_bill_reminders dedupe), creates a Cadence task and sends a push
 * notification. Called after every sync — cron, webhook, and manual — so a
 * bill about to come due gets caught quickly regardless of which path
 * triggered the sync.
 */
export async function checkBillReminders(db: SupabaseClient, userId: string): Promise<number> {
  const since = new Date(Date.now() - 120 * 86400000).toISOString().slice(0, 10);
  const { data } = await db
    .from("plaid_transactions")
    .select("name, merchant_name, amount, date, pending")
    .eq("user_id", userId)
    .gte("date", since);
  const bills = detectRecurringBills(data ?? []);

  const in3Days = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  const dueSoon = bills.filter((b) => b.nextEstimate && b.nextEstimate >= today && b.nextEstimate <= in3Days);

  let created = 0;
  for (const bill of dueSoon) {
    const { data: already } = await db
      .from("plaid_bill_reminders")
      .select("id")
      .eq("user_id", userId)
      .eq("bill_key", bill.key)
      .eq("due_date", bill.nextEstimate)
      .maybeSingle();
    if (already) continue;

    const { data: task, error } = await db
      .from("tasks")
      .insert({
        user_id: userId,
        title: `Pay ${bill.label} (~$${bill.amount.toFixed(2)})`,
        due_date: bill.nextEstimate,
        due_kind: "day",
        priority: 0,
        notes: `— recurring bill detected from bank transactions, ${bill.cadence}`,
      })
      .select()
      .single();
    if (error) continue;

    await runTriggerAutomations(
      db,
      "task_created",
      { title: task.title, anchorDate: new Date(`${bill.nextEstimate}T00:00:00`), entity: { table: "tasks", id: task.id } },
      userId,
      sendPushToUser
    );
    await db.from("plaid_bill_reminders").insert({
      user_id: userId,
      bill_key: bill.key,
      due_date: bill.nextEstimate,
      task_id: task.id,
    });
    created++;
  }

  if (created > 0) {
    await sendPushToUser(db, userId, {
      title: "Upcoming bills",
      body: `Added ${created} bill reminder${created === 1 ? "" : "s"} due in the next 3 days`,
      url: "/app/finance",
      tag: "plaid-bills",
    });
  }
  return created;
}
