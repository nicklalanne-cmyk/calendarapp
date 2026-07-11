import { createClient } from "@/lib/supabase/client";

const KEY = "cadence-hidden-cals";

/** Local cache so the first paint is instant; the server copy is the source of truth. */
export function getHiddenCals(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    return new Set(JSON.parse(localStorage.getItem(KEY) || "[]") as string[]);
  } catch {
    return new Set();
  }
}

function cache(s: Set<string>) {
  try {
    localStorage.setItem(KEY, JSON.stringify([...s]));
  } catch {
    /* ignore */
  }
}

/** Pull the synced list from the server and update the local cache. */
export async function syncHiddenCals(): Promise<Set<string>> {
  const supabase = createClient();
  const { data } = await supabase.from("user_settings").select("hidden_calendars").maybeSingle();
  const s = new Set((data?.hidden_calendars as string[] | null) ?? []);
  cache(s);
  if (typeof window !== "undefined") window.dispatchEvent(new Event("cadence:cals-changed"));
  return s;
}

export async function setHiddenCals(s: Set<string>) {
  cache(s);
  if (typeof window !== "undefined") window.dispatchEvent(new Event("cadence:cals-changed"));

  const supabase = createClient();
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return;
  await supabase.from("user_settings").upsert({
    user_id: u.user.id,
    hidden_calendars: [...s],
    updated_at: new Date().toISOString(),
  });
}
