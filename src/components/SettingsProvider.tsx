"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { syncHiddenCals } from "@/lib/calfilter";
import type { UserSettings } from "@/lib/types";

const DEFAULTS: Omit<UserSettings, "user_id"> = {
  default_view: "day",
  home_page: "/app",
  agenda_view: "week",
  handwriting_enabled: true,
  pomo_work: 25,
  pomo_short: 5,
  pomo_long: 15,
  pomo_rounds: 4,
  pomo_autostart: false,
};

const LS_KEY = "cadence-settings";

type Ctx = {
  settings: Omit<UserSettings, "user_id">;
  ready: boolean;
  update: (patch: Partial<Omit<UserSettings, "user_id">>) => Promise<void>;
};

const SettingsCtx = createContext<Ctx>({
  settings: DEFAULTS,
  ready: false,
  update: async () => {},
});

export const useSettings = () => useContext(SettingsCtx);

export default function SettingsProvider({ children }: { children: React.ReactNode }) {
  const supabase = createClient();
  const [settings, setSettings] = useState(DEFAULTS);
  const [ready, setReady] = useState(false);

  // instant paint from the local cache, then reconcile with the server
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        setSettings({ ...DEFAULTS, ...JSON.parse(raw) });
        setReady(true);
      }
    } catch {
      /* ignore */
    }
    (async () => {
      const { data } = await supabase.from("user_settings").select("*").maybeSingle();
      if (data) {
        const s = {
          default_view: data.default_view,
          home_page: data.home_page,
          agenda_view: data.agenda_view,
          handwriting_enabled: data.handwriting_enabled ?? true,
          pomo_work: data.pomo_work ?? 25,
          pomo_short: data.pomo_short ?? 5,
          pomo_long: data.pomo_long ?? 15,
          pomo_rounds: data.pomo_rounds ?? 4,
          pomo_autostart: data.pomo_autostart ?? false,
        } as Omit<UserSettings, "user_id">;
        setSettings(s);
        try {
          localStorage.setItem(LS_KEY, JSON.stringify(s));
        } catch {
          /* ignore */
        }
      }
      // calendar show/hide lives on the server now, so it follows you between devices
      syncHiddenCals().catch(() => {});
      setReady(true);
    })();
  }, [supabase]);

  const update = useCallback(
    async (patch: Partial<Omit<UserSettings, "user_id">>) => {
      const next = { ...settings, ...patch };
      setSettings(next);
      try {
        localStorage.setItem(LS_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return;
      await supabase
        .from("user_settings")
        .upsert({ user_id: u.user.id, ...next, updated_at: new Date().toISOString() });
    },
    [settings, supabase]
  );

  return (
    <SettingsCtx.Provider value={{ settings, ready, update }}>{children}</SettingsCtx.Provider>
  );
}
