// Google token helpers used for the multi-account calendar connections.

export async function getGoogleAccessToken(refreshToken: string): Promise<string | null> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
    cache: "no-store",
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { access_token?: string };
  return data.access_token ?? null;
}

/**
 * Revokes a refresh token with Google so disconnecting an account in Cadence
 * actually pulls Cadence out of the user's "Third-party apps with account
 * access" list, instead of just deleting our local row while Google still
 * thinks the grant is live. Revoking a refresh token also invalidates any
 * access tokens minted from it. Best-effort: if Google's already forgotten
 * the token (expired/already revoked) this returns true anyway since the
 * end state — no live grant — is what we actually care about.
 */
export async function revokeGoogleToken(token: string): Promise<boolean> {
  try {
    const res = await fetch("https://oauth2.googleapis.com/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
      cache: "no-store",
    });
    return res.ok || res.status === 400;
  } catch {
    return false;
  }
}

export type ExchangedTokens = {
  access_token?: string;
  refresh_token?: string;
  id_token?: string;
};

export async function exchangeCodeForTokens(
  code: string,
  redirectUri: string
): Promise<ExchangedTokens | null> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      code,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
    cache: "no-store",
  });
  if (!res.ok) return null;
  return (await res.json()) as ExchangedTokens;
}
