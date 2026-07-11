import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/google/session";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { user } = await requireUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));

  const origin = request.nextUrl.origin;
  const redirectUri = `${origin}/api/google/connect/callback`;
  const state = crypto.randomUUID();

  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", process.env.GOOGLE_CLIENT_ID ?? "");
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email https://www.googleapis.com/auth/calendar");
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent select_account");
  url.searchParams.set("include_granted_scopes", "false");
  url.searchParams.set("state", state);

  const res = NextResponse.redirect(url.toString());
  res.cookies.set("g_connect_state", state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  return res;
}
