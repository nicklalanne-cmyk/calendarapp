import type { SupabaseClient } from "@supabase/supabase-js";
import webpush from "web-push";
import type { SendPushFn } from "@/lib/automations";

/**
 * Server-only. Imports the Node-only `web-push` library, so this file must
 * never be imported from a client component (Planner.tsx, AgendaView.tsx,
 * AutomationsView.tsx) — doing so breaks the client webpack bundle, which
 * can't resolve web-push's transitive 'net'/'tls' Node built-ins. Only
 * server code (API routes, the reminders cron, the Plaud sync job) should
 * import from here.
 *
 * Sends one push notification to every subscription this user has, cleaning
 * up subscriptions the browser has since dropped (404/410).
 */
export const sendPushToUser: SendPushFn = async (
  supabase: SupabaseClient,
  userId: string,
  payload: { title: string; body: string; url?: string; tag?: string }
) => {
  const vapidPublic = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const vapidPrivate = process.env.VAPID_PRIVATE_KEY;
  if (!vapidPublic || !vapidPrivate) return;
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || "mailto:nick@oneluxuryint.com",
    vapidPublic,
    vapidPrivate
  );
  const { data } = await supabase.from("push_subscriptions").select("*").eq("user_id", userId);
  const subs = (data as { id: string; endpoint: string; p256dh: string; auth: string }[] | null) ?? [];
  for (const s of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify({ title: payload.title, body: payload.body, url: payload.url ?? "/app", tag: payload.tag })
      );
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) {
        await supabase.from("push_subscriptions").delete().eq("id", s.id);
      }
    }
  }
};
