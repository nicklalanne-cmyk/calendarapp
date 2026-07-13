import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createHash, randomBytes } from "crypto";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Bearer-token auth for the external "Skill" API (src/app/api/skill/**).
 *
 * These routes are called from OUTSIDE the browser (Claude Code, Cowork, a
 * script on the user's own machine) so there's no Supabase session cookie to
 * read. Instead the caller sends `Authorization: Bearer <token>`; we hash it,
 * look it up in api_keys, and use the Supabase *service role* client (which
 * bypasses RLS) for everything that follows — every query in a skill route
 * MUST manually filter `.eq("user_id", userId)` since RLS isn't doing that
 * job here.
 */

const TOKEN_PREFIX = "cad_live_";

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function generateToken(): { token: string; prefix: string } {
  const token = TOKEN_PREFIX + randomBytes(24).toString("base64url");
  return { token, prefix: token.slice(0, TOKEN_PREFIX.length + 6) };
}

function serviceClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

export type ApiAuthResult =
  | { ok: true; userId: string; db: SupabaseClient }
  | { ok: false; response: NextResponse };

/** Authenticates a skill API request via its Bearer token. Also updates
 * last_used_at (best-effort, doesn't block the response on failure). */
export async function authenticateApiRequest(req: NextRequest): Promise<ApiAuthResult> {
  const db = serviceClient();
  if (!db) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Skill API isn't configured on this server (missing SUPABASE_SERVICE_ROLE_KEY)." },
        { status: 501 }
      ),
    };
  }

  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Missing Authorization: Bearer <token> header." },
        { status: 401 }
      ),
    };
  }

  const { data, error } = await db
    .from("api_keys")
    .select("user_id")
    .eq("token_hash", hashToken(token))
    .maybeSingle();

  if (error || !data) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Invalid or revoked API token." }, { status: 401 }),
    };
  }

  db.from("api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("user_id", data.user_id)
    .then(() => {});

  return { ok: true, userId: data.user_id, db };
}
