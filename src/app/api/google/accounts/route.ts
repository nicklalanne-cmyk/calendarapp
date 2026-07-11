import { NextResponse } from "next/server";
import { requireUser } from "@/lib/google/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const { supabase, user } = await requireUser();
  if (!user) return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  const { data } = await supabase
    .from("google_accounts")
    .select("id, google_email, is_default")
    .order("created_at", { ascending: true });
  return NextResponse.json({ accounts: data ?? [] });
}
