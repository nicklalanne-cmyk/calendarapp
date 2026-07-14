import type { SupabaseClient } from "@supabase/supabase-js";
import { fireNoteCreated } from "@/lib/automations";
import { sendPushToUser } from "@/lib/push-server";

const TOKEN_URL = "https://platform.plaud.ai/developer/api/oauth/third-party/access-token/refresh";
const API_BASE = "https://platform.plaud.ai/developer/api";

export type PlaudAccountRow = {
  user_id: string;
  access_token: string;
  refresh_token: string;
  expires_at: string | null;
  last_synced_created_at: string | null;
  pending: Record<string, string>;
};

export type PlaudFile = {
  id: string;
  name: string;
  created_at: string;
  start_at?: string;
  duration?: number;
  source_list?: { data_type: string; data_content: string }[];
  note_list?: { data_type: string; data_content: string }[];
};

// Refreshes the access token if it's expired (or about to expire) and
// persists the new token set back to the plaud_accounts row. Returns a
// valid access token to use for this request.
export async function getValidPlaudAccessToken(
  db: SupabaseClient,
  account: PlaudAccountRow
): Promise<string> {
  const expiresAt = account.expires_at ? new Date(account.expires_at).getTime() : 0;
  if (expiresAt && Date.now() < expiresAt - 60_000) {
    return account.access_token;
  }

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({ refresh_token: account.refresh_token }),
  });
  if (!res.ok) {
    throw new Error(`Plaud token refresh failed: ${res.status} ${await res.text().catch(() => "")}`);
  }
  const data = await res.json();
  const newAccessToken: string = data.access_token;
  const newRefreshToken: string = data.refresh_token ?? account.refresh_token;
  const newExpiresAt = data.expires_in ? new Date(Date.now() + data.expires_in * 1000).toISOString() : null;

  await db
    .from("plaud_accounts")
    .update({
      access_token: newAccessToken,
      refresh_token: newRefreshToken,
      expires_at: newExpiresAt,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", account.user_id);

  return newAccessToken;
}

async function plaudFetch(accessToken: string, path: string) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`Plaud API ${res.status}: ${(await res.text().catch(() => "")).slice(0, 300)}`);
  }
  return res.json();
}

export async function listPlaudFiles(accessToken: string, pages = 3, pageSize = 20): Promise<PlaudFile[]> {
  const all: PlaudFile[] = [];
  for (let page = 1; page <= pages; page++) {
    const json = await plaudFetch(accessToken, `/open/third-party/files/?page=${page}&page_size=${pageSize}`);
    const data: PlaudFile[] = json.data ?? [];
    all.push(...data);
    if (data.length < pageSize) break;
  }
  return all;
}

export async function getPlaudFile(accessToken: string, fileId: string): Promise<PlaudFile> {
  return plaudFetch(accessToken, `/open/third-party/files/${fileId}`);
}

export function extractSummary(file: PlaudFile): string | null {
  const note = (file.note_list ?? []).find((n) => n.data_type === "auto_sum_note");
  return note && note.data_content ? note.data_content : null;
}

export function extractTranscriptPreview(file: PlaudFile, maxChars = 1200): string | null {
  const source = (file.source_list ?? []).find((s) => s.data_type === "transaction");
  if (!source || !source.data_content) return null;
  try {
    const segments = JSON.parse(source.data_content) as { content: string }[];
    const text = segments.map((s) => s.content).join(" ");
    return text.length > maxChars ? text.slice(0, maxChars) + "…" : text;
  } catch {
    return null;
  }
}

const PENDING_MAX_AGE_MS = 48 * 60 * 60 * 1000;

// Runs one sync pass for a single user's Plaud account: finds recordings
// newer than the last checkpoint (or previously pending), creates a Cadence
// Note for any that now have a finished AI summary, and updates the
// checkpoint/pending state. Returns a small summary of what happened.
export async function syncPlaudAccount(db: SupabaseClient, account: PlaudAccountRow) {
  const accessToken = await getValidPlaudAccessToken(db, account);
  const files = await listPlaudFiles(accessToken);
  files.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

  const now = Date.now();
  const pending: Record<string, string> = { ...account.pending };
  for (const [id, firstSeen] of Object.entries(pending)) {
    if (now - new Date(firstSeen).getTime() > PENDING_MAX_AGE_MS) delete pending[id];
  }

  let lastSyncedCreatedAt = account.last_synced_created_at;
  for (const f of files) {
    const isNew = !lastSyncedCreatedAt || new Date(f.created_at) > new Date(lastSyncedCreatedAt);
    if (isNew) {
      if (!pending[f.id]) pending[f.id] = new Date().toISOString();
      if (!lastSyncedCreatedAt || new Date(f.created_at) > new Date(lastSyncedCreatedAt)) {
        lastSyncedCreatedAt = f.created_at;
      }
    }
  }

  let created = 0;
  const stillPending: string[] = [];
  for (const fileId of Object.keys(pending)) {
    try {
      const detail = await getPlaudFile(accessToken, fileId);
      const summary = extractSummary(detail);
      if (!summary) {
        stillPending.push(fileId);
        continue;
      }
      const preview = extractTranscriptPreview(detail);
      const body = [summary, preview ? `\n---\nTranscript excerpt:\n${preview}` : ""].join("");
      const noteDate = (detail.start_at || detail.created_at || "").slice(0, 10) || null;
      const { error } = await db.from("notes").insert({
        user_id: account.user_id,
        title: `Plaud: ${detail.name}`,
        body,
        note_date: noteDate,
        shared: false,
        source: "plaud",
      });
      if (error) throw new Error(error.message);
      // service-role client has no session to resolve a user from, so pass
      // the owning user's id explicitly.
      await fireNoteCreated(
        db,
        { title: `Plaud: ${detail.name}`, body, source: "plaud" },
        account.user_id,
        sendPushToUser
      );
      delete pending[fileId];
      created++;
    } catch {
      stillPending.push(fileId);
    }
  }

  await db
    .from("plaud_accounts")
    .update({
      last_synced_created_at: lastSyncedCreatedAt,
      pending,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", account.user_id);

  return { created, pendingCount: Object.keys(pending).length };
}
