import { NextResponse } from "next/server";
import { requireUser } from "@/lib/google/session";
import { generateToken, hashToken } from "@/lib/apiAuth";

// Cookie-session-gated — called from the browser (Settings page), unlike
// everything under /api/skill/v1/** which is Bearer-token gated.

export async function GET() {
  const { supabase, user } = await requireUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { data } = await supabase
    .from("api_keys")
    .select("token_prefix,created_at,last_used_at")
    .eq("user_id", user.id)
    .maybeSingle();

  return NextResponse.json({ key: data ?? null });
}

// Generates a new key, replacing any existing one for this user (only ever
// one live token per account, per the "one token, revocable" design).
export async function POST() {
  const { supabase, user } = await requireUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { token, prefix } = generateToken();
  const { error } = await supabase.from("api_keys").upsert({
    user_id: user.id,
    token_hash: hashToken(token),
    token_prefix: prefix,
    created_at: new Date().toISOString(),
    last_used_at: null,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // The plaintext token is only ever returned here, once.
  return NextResponse.json({ token, prefix });
}

export async function DELETE() {
  const { supabase, user } = await requireUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { error } = await supabase.from("api_keys").delete().eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
