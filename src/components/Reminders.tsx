"use client";

import { useCallback, useEffect, useState } from "react";
import { Bell, BellOff, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/lib/toast";

function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export default function Reminders() {
  const supabase = createClient();
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);

  const vapid = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

  // reflect the real browser subscription, not a localStorage guess
  useEffect(() => {
    (async () => {
      if (!("serviceWorker" in navigator) || typeof Notification === "undefined") return;
      try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        setOn(Boolean(sub) && Notification.permission === "granted");
      } catch {
        /* ignore */
      }
    })();
  }, []);

  const enable = useCallback(async () => {
    if (!vapid) {
      toast(
        "Push isn't configured yet — add NEXT_PUBLIC_VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY in Vercel.",
        "error"
      );
      return;
    }
    setBusy(true);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        toast("Notifications are blocked for this site.", "error");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapid),
        }));

      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription: sub.toJSON() }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        toast(j.error ?? "Couldn't register for push", "error");
        return;
      }

      // remember the device's timezone so the digest fires at the right local hour
      const { data: u } = await supabase.auth.getUser();
      if (u.user) {
        await supabase.from("user_settings").upsert({
          user_id: u.user.id,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          push_enabled: true,
          updated_at: new Date().toISOString(),
        });
      }

      setOn(true);
      toast("Reminders on — they'll arrive even when Cadence is closed.");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }, [vapid, supabase]);

  const disable = useCallback(async () => {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetch(`/api/push/subscribe?endpoint=${encodeURIComponent(sub.endpoint)}`, {
          method: "DELETE",
        });
        await sub.unsubscribe();
      }
      setOn(false);
      toast("Reminders off");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <button
      onClick={() => (on ? disable() : enable())}
      disabled={busy}
      title={on ? "Reminders on — tap to turn off" : "Turn on background reminders"}
      aria-label="Reminders"
      className="flex h-11 w-11 items-center justify-center rounded-xl text-txt3 transition hover:bg-surface hover:text-txt disabled:opacity-50"
    >
      {busy ? (
        <Loader2 className="h-5 w-5 animate-spin" />
      ) : on ? (
        <Bell className="h-5 w-5 text-accent" />
      ) : (
        <BellOff className="h-5 w-5" />
      )}
    </button>
  );
}
