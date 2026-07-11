import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/google/session";
import { exchangeCodeForTokens } from "@/lib/google/tokens";

export const dynamic = "force-dynamic";

function emailFromIdToken(idToken?: string): string {
  if (!idToken) return "";
  try {
    const payload = idToken.split(".")[1];
    const json = Buffer.from(
      payload.replace(/-/g, "+").replace(/_/g, "/"),
      "base64"
    ).toString("utf8");
    return (JSON.parse(json).email as string) ?? "";
  } catch {
    return "";
  }
}

export async function GET(request: NextRequest) {
  const { supabase, user } = await requireUser();
  const origin = request.nextUrl.origin;
  if (!user) return NextResponse.redirect(new URL("/login", request.url));

  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const cookieState = request.cookies.get("g_connect_state")?.value;

  if (!code || !state || state !== cookieState) {
    return NextResponse.redirect(`${origin}/app/accounts?error=state`);
  }

  const tokens = await exchangeCodeForTokens(code, `${origin}/api/google/connect/callback`);
  if (!tokens?.refresh_token) {
    return NextResponse.redirect(`${origin}/app/accounts?error=no_refresh`);
  }

  let email = emailFromIdToken(tokens.id_token);
  if (!email && tokens.access_token) {
    const r = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
      cache: "no-store",
    });
    if (r.ok) email = ((await r.json()).email as string) ?? "";
  }
  email = email || "unknown";

  const { data: existing } = await supabase
    .from("google_accounts")
    .select("id")
    .eq("user_id", user.id);
  const isFirst = !existing || existing.length === 0;

  await supabase.from("google_accounts").upsert(
    {
      user_id: user.id,
      google_email: email,
      refresh_token: tokens.refresh_token,
    },
    { onConflict: "user_id,google_email" }
  );

  if (isFirst) {
    await supabase
      .from("google_accounts")
      .update({ is_default: true })
      .eq("user_id", user.id)
      .eq("google_email", email);
  }

  const res = NextResponse.redirect(`${origin}/app/accounts?connected=1`);
  res.cookies.set("g_connect_state", "", { maxAge: 0, path: "/" });
  return res;
}
