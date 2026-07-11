"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/** Admins get an inbox link + an open-count badge. Everyone else gets nothing. */
export function useAdminInbox() {
  const supabase = createClient();
  const [isAdmin, setIsAdmin] = useState(false);
  const [openCount, setOpenCount] = useState(0);

  const refresh = useCallback(async () => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;

    const { data: admin } = await supabase
      .from("app_admins")
      .select("user_id")
      .eq("user_id", u.user.id)
      .maybeSingle();

    if (!admin) {
      setIsAdmin(false);
      return;
    }
    setIsAdmin(true);

    const { count } = await supabase
      .from("feedback")
      .select("id", { count: "exact", head: true })
      .eq("status", "open");
    setOpenCount(count ?? 0);
  }, [supabase]);

  useEffect(() => {
    refresh();
    const h = () => refresh();
    window.addEventListener("cadence:feedback-changed", h);
    return () => window.removeEventListener("cadence:feedback-changed", h);
  }, [refresh]);

  return { isAdmin, openCount, refresh };
}
