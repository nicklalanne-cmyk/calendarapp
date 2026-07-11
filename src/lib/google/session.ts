import { createClient } from "@/lib/supabase/server";

export type GoogleAccountRow = {
  id: string;
  user_id: string;
  google_email: string;
  refresh_token: string;
  is_default: boolean;
};

export async function requireUser() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}
