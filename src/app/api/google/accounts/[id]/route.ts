import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/google/session";

export const dynamic = "force-dynamic";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const { supabase, user } = await requireUser();
  if (!user) return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  await supabase.from("google_accounts").delete().eq("id", params.id);
  return NextResponse.json({ ok: true });
}

export async function PATCH(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const { supabase, user } = await requireUser();
  if (!user) return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  await supabase.from("google_accounts").update({ is_default: false }).eq("user_id", user.id);
  await supabase.from("google_accounts").update({ is_default: true }).eq("id", params.id);
  return NextResponse.json({ ok: true });
}
