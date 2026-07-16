import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/google/session";
import { revokeGoogleToken } from "@/lib/google/tokens";
import type { GoogleAccountRow } from "@/lib/google/session";

export const dynamic = "force-dynamic";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const { supabase, user } = await requireUser();
  if (!user) return NextResponse.json({ error: "not_signed_in" }, { status: 401 });

  const { data } = await supabase
    .from("google_accounts")
    .select("refresh_token")
    .eq("id", params.id)
    .eq("user_id", user.id)
    .maybeSingle();
  const acc = data as Pick<GoogleAccountRow, "refresh_token"> | null;

  // Revoke with Google first so the grant is actually gone even if the row
  // delete somehow fails; refresh tokens don't expire on their own, so a row
  // delete with no revoke leaves Cadence listed indefinitely under the
  // user's Google "connected apps".
  if (acc?.refresh_token) {
    await revokeGoogleToken(acc.refresh_token);
  }

  await supabase.from("google_accounts").delete().eq("id", params.id).eq("user_id", user.id);
  return NextResponse.json({ ok: true });
}

export async function PATCH(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const { supabase, user } = await requireUser();
  if (!user) return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  await supabase.from("google_accounts").update({ is_default: false }).eq("user_id", user.id);
  await supabase.from("google_accounts").update({ is_default: true }).eq("id", params.id).eq("user_id", user.id);
  return NextResponse.json({ ok: true });
}
