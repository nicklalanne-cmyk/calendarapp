import { NextResponse } from "next/server";
import { requireUser } from "@/lib/google/session";

export async function GET() {
  const { supabase, user } = await requireUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { data, error } = await supabase
    .from("plaid_budgets")
    .select("*")
    .eq("user_id", user.id)
    .order("category", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ budgets: data ?? [] });
}

export async function POST(request: Request) {
  const { supabase, user } = await requireUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const category: string | undefined = body.category?.trim();
  const monthlyLimit: number | undefined = body.monthly_limit;
  if (!category || !monthlyLimit || !(monthlyLimit > 0)) {
    return NextResponse.json({ error: "category and a positive monthly_limit are required" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("plaid_budgets")
    .upsert(
      { user_id: user.id, category, monthly_limit: monthlyLimit, updated_at: new Date().toISOString() },
      { onConflict: "user_id,category" }
    )
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ budget: data });
}

export async function DELETE(request: Request) {
  const { supabase, user } = await requireUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const category: string | undefined = body.category;
  if (!category) return NextResponse.json({ error: "missing category" }, { status: 400 });

  const { error } = await supabase.from("plaid_budgets").delete().eq("user_id", user.id).eq("category", category);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
