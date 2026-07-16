import { NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { revokeGoogleToken } from "@/lib/google/tokens";

export const dynamic = "force-dynamic";

/**
 * Permanently deletes the signed-in user's account and everything tied to
 * it. Every user-owned table has an `ON DELETE CASCADE` foreign key to
 * `auth.users`, so deleting the auth user via the admin API removes all of
 * it — tasks, notes, notebooks, automations, settings, connected Google
 * accounts, everything — in one step. This route best-effort revokes each
 * connected Google account's OAuth grant first (the cascade only deletes
 * Cadence's own row; Google doesn't know to forget the token on its own),
 * then does the actual auth-user delete with the service-role key, since
 * `auth.admin.deleteUser` isn't available to a normal RLS-scoped client.
 *
 * There is no undo. The client is expected to have already confirmed this
 * with the user (e.g. typing "DELETE") before calling here.
 */
export async function POST() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not_signed_in" }, { status: 401 });

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!serviceKey || !url) {
    return NextResponse.json({ error: "Account deletion isn't configured on this server." }, { status: 500 });
  }

  const { data: accounts } = await supabase
    .from("google_accounts")
    .select("refresh_token")
    .eq("user_id", user.id);
  await Promise.all(
    ((accounts as { refresh_token: string }[] | null) ?? []).map((a) => revokeGoogleToken(a.refresh_token))
  );

  const admin = createServiceClient(url, serviceKey, { auth: { persistSession: false } });
  const { error } = await admin.auth.admin.deleteUser(user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
