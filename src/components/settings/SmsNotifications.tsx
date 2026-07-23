"use client";

import { useEffect, useState } from "react";
import { MessageSquare, Plus, Trash2, Send, Loader2 } from "lucide-react";
import clsx from "clsx";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/lib/toast";

type Notification = {
  id: string;
  kind: "today_schedule" | "accomplished_today" | "custom";
  label: string;
  hour: number;
  minute: number;
  enabled: boolean;
  message: string | null;
};

const KIND_OPTIONS: { value: Notification["kind"]; label: string; hint: string }[] = [
  { value: "today_schedule", label: "Today's schedule", hint: "Calendar events + tasks due today" },
  { value: "accomplished_today", label: "Accomplished today", hint: "Tasks you checked off today" },
  { value: "custom", label: "Custom message", hint: "Your own literal text" },
];

const MINUTES = [0, 15, 30, 45];

function timeLabel(hour: number, minute: number) {
  const h12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  const ampm = hour < 12 ? "AM" : "PM";
  return `${h12}:${String(minute).padStart(2, "0")} ${ampm}`;
}

/** "Very customizable" per Nick's ask: a phone number + master switch, plus
 * an arbitrary list of scheduled texts (built-in "today's schedule" /
 * "accomplished today" digests, or a fully custom literal message), each
 * with its own on/off toggle and time. Reads/writes sms_settings +
 * sms_notifications directly via the RLS-scoped browser client, same
 * pattern as the rest of Settings.
 *
 * Per-event/per-task reminders (e.g. "text me 1 hour before this meeting")
 * are configured separately, right on the event/task itself (see the
 * "Remind me" picker in EventModal/TaskModal) — not here, since those need
 * a specific time to count down from rather than a daily schedule. */
export default function SmsNotifications() {
  const supabase = createClient();
  const [loaded, setLoaded] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [phone, setPhone] = useState("");
  const [notifs, setNotifs] = useState<Notification[]>([]);
  const [adding, setAdding] = useState(false);
  const [newKind, setNewKind] = useState<Notification["kind"]>("today_schedule");
  const [newLabel, setNewLabel] = useState("");
  const [newHour, setNewHour] = useState(9);
  const [newMinute, setNewMinute] = useState(0);
  const [newMessage, setNewMessage] = useState("");
  const [testing, setTesting] = useState(false);

  const load = async () => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    const [{ data: settingsRow }, { data: notifRows }] = await Promise.all([
      supabase.from("sms_settings").select("phone_number, enabled").eq("user_id", u.user.id).maybeSingle(),
      supabase
        .from("sms_notifications")
        .select("id, kind, label, hour, minute, enabled, message")
        .eq("user_id", u.user.id)
        .order("hour", { ascending: true })
        .order("minute", { ascending: true }),
    ]);

    // First time this user's ever opened this section (no sms_settings row
    // yet) — text notifications default ON, with the same starter pair of
    // digests Nick set up, rather than a cold empty section someone has to
    // discover and configure from scratch.
    if (!settingsRow) {
      await supabase.from("sms_settings").upsert({ user_id: u.user.id, enabled: true });
      const { data: seeded } = await supabase
        .from("sms_notifications")
        .insert([
          { user_id: u.user.id, kind: "today_schedule", label: "Today's Schedule", hour: 7, minute: 0, enabled: true },
          { user_id: u.user.id, kind: "accomplished_today", label: "Accomplished Today", hour: 20, minute: 0, enabled: true },
        ])
        .select("id, kind, label, hour, minute, enabled, message");
      setEnabled(true);
      setPhone("");
      setNotifs((seeded as Notification[] | null) ?? []);
      setLoaded(true);
      return;
    }

    setEnabled((settingsRow as { enabled: boolean } | null)?.enabled ?? false);
    setPhone((settingsRow as { phone_number: string | null } | null)?.phone_number ?? "");
    setNotifs((notifRows as Notification[] | null) ?? []);
    setLoaded(true);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const savePrefs = async (next: { enabled?: boolean; phone_number?: string }) => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    const patch: Record<string, unknown> = { user_id: u.user.id, updated_at: new Date().toISOString() };
    if (next.enabled !== undefined) patch.enabled = next.enabled;
    if (next.phone_number !== undefined) patch.phone_number = next.phone_number;
    const { error } = await supabase.from("sms_settings").upsert(patch);
    if (error) toast(error.message, "error");
  };

  const toggleMaster = (v: boolean) => {
    setEnabled(v);
    savePrefs({ enabled: v });
  };

  const savePhone = () => {
    savePrefs({ phone_number: phone.trim() });
    toast("Saved");
  };

  const toggleNotif = async (n: Notification) => {
    setNotifs((cur) => cur.map((x) => (x.id === n.id ? { ...x, enabled: !x.enabled } : x)));
    const { error } = await supabase.from("sms_notifications").update({ enabled: !n.enabled }).eq("id", n.id);
    if (error) {
      setNotifs((cur) => cur.map((x) => (x.id === n.id ? { ...x, enabled: n.enabled } : x)));
      toast(error.message, "error");
    }
  };

  const updateTime = async (n: Notification, hour: number, minute: number) => {
    setNotifs((cur) => cur.map((x) => (x.id === n.id ? { ...x, hour, minute } : x)));
    const { error } = await supabase.from("sms_notifications").update({ hour, minute }).eq("id", n.id);
    if (error) toast(error.message, "error");
  };

  const deleteNotif = async (n: Notification) => {
    setNotifs((cur) => cur.filter((x) => x.id !== n.id));
    const { error } = await supabase.from("sms_notifications").delete().eq("id", n.id);
    if (error) toast(error.message, "error");
  };

  const addNotif = async () => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    const opt = KIND_OPTIONS.find((o) => o.value === newKind)!;
    const label = newLabel.trim() || opt.label;
    if (newKind === "custom" && !newMessage.trim()) return toast("Add a message for a custom text.", "error");
    const { data, error } = await supabase
      .from("sms_notifications")
      .insert({
        user_id: u.user.id,
        kind: newKind,
        label,
        hour: newHour,
        minute: newMinute,
        enabled: true,
        message: newKind === "custom" ? newMessage.trim() : null,
      })
      .select("id, kind, label, hour, minute, enabled, message")
      .single();
    if (error) return toast(error.message, "error");
    setNotifs((cur) => [...cur, data as Notification].sort((a, b) => a.hour * 60 + a.minute - (b.hour * 60 + b.minute)));
    setAdding(false);
    setNewLabel("");
    setNewMessage("");
  };

  const sendTest = async () => {
    setTesting(true);
    try {
      const res = await fetch("/api/sms/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: phone.trim() }),
      });
      const j = await res.json();
      if (!res.ok) return toast(j.error ?? "Couldn't send that.", "error");
      toast("Test text sent — check your phone.");
    } finally {
      setTesting(false);
    }
  };

  if (!loaded) return null;

  return (
    <section className="mb-6 rounded-xl border border-border bg-surface p-4">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold">
            <MessageSquare className="h-4 w-4" /> Text notifications
          </h2>
          <p className="mt-1 text-xs text-txt3">
            Real SMS texts (via Twilio) at whatever times you set — your daily schedule, what you
            got done, or anything custom. For a heads-up before a specific event or task, use the
            &quot;Remind me&quot; option when creating/editing it instead.
          </p>
        </div>
        <button
          onClick={() => toggleMaster(!enabled)}
          role="switch"
          aria-checked={enabled}
          className={clsx(
            "relative h-6 w-11 shrink-0 rounded-full transition",
            enabled ? "bg-accent" : "bg-surface3"
          )}
        >
          <span
            className={clsx(
              "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform",
              enabled ? "translate-x-[22px]" : "translate-x-0.5"
            )}
          />
        </button>
      </div>

      <div className="mt-4 flex items-end gap-2 border-t border-border pt-3">
        <label className="block flex-1">
          <span className="mb-1 block text-xs text-txt3">Phone number</span>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            onBlur={savePhone}
            placeholder="(321) 505-0288"
            className="w-full rounded-lg border border-border bg-surface2 px-2 py-1.5 text-sm text-txt"
          />
        </label>
        <button
          onClick={sendTest}
          disabled={!phone.trim() || testing}
          title="Send a test text now"
          className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-surface2 px-3 py-1.5 text-xs font-medium text-txt2 transition hover:border-accent hover:text-txt disabled:opacity-40"
        >
          {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          Send test
        </button>
      </div>

      <div className="mt-3 space-y-2">
        {notifs.map((n) => (
          <div
            key={n.id}
            className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface2/60 px-3 py-2"
          >
            <button
              onClick={() => toggleNotif(n)}
              role="switch"
              aria-checked={n.enabled}
              className={clsx(
                "relative mr-1 h-5 w-9 shrink-0 rounded-full transition",
                n.enabled ? "bg-accent" : "bg-surface3"
              )}
            >
              <span
                className={clsx(
                  "absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform",
                  n.enabled ? "translate-x-[18px]" : "translate-x-0.5"
                )}
              />
            </button>
            <div className="min-w-0 flex-1 pl-1">
              <div className="truncate text-sm text-txt">{n.label}</div>
              {n.kind === "custom" && n.message && (
                <div className="truncate text-[11px] text-txt3">{n.message}</div>
              )}
            </div>
            <select
              value={`${n.hour}:${n.minute}`}
              onChange={(e) => {
                const [h, m] = e.target.value.split(":").map(Number);
                updateTime(n, h, m);
              }}
              className="rounded-lg border border-border bg-surface px-2 py-1 text-xs text-txt"
            >
              {Array.from({ length: 24 }, (_, h) => h).flatMap((h) =>
                MINUTES.map((m) => (
                  <option key={`${h}:${m}`} value={`${h}:${m}`}>
                    {timeLabel(h, m)}
                  </option>
                ))
              )}
            </select>
            <button
              onClick={() => deleteNotif(n)}
              className="rounded-lg p-1.5 text-txt3 transition hover:bg-surface3 hover:text-danger"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
        {notifs.length === 0 && <p className="text-xs text-txt3">No scheduled texts yet.</p>}
      </div>

      {adding ? (
        <div className="mt-3 space-y-2 rounded-lg border border-border bg-surface2/60 p-3">
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="mb-1 block text-xs text-txt3">Type</span>
              <select
                value={newKind}
                onChange={(e) => setNewKind(e.target.value as Notification["kind"])}
                className="w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-txt"
              >
                {KIND_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-txt3">Time</span>
              <div className="flex gap-1">
                <select
                  value={newHour}
                  onChange={(e) => setNewHour(parseInt(e.target.value, 10))}
                  className="w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-txt"
                >
                  {Array.from({ length: 24 }, (_, h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
                <select
                  value={newMinute}
                  onChange={(e) => setNewMinute(parseInt(e.target.value, 10))}
                  className="w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-txt"
                >
                  {MINUTES.map((m) => (
                    <option key={m} value={m}>
                      :{String(m).padStart(2, "0")}
                    </option>
                  ))}
                </select>
              </div>
            </label>
          </div>
          <label className="block">
            <span className="mb-1 block text-xs text-txt3">Label (optional)</span>
            <input
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder={KIND_OPTIONS.find((o) => o.value === newKind)?.label}
              className="w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-txt"
            />
          </label>
          {newKind === "custom" && (
            <label className="block">
              <span className="mb-1 block text-xs text-txt3">Message</span>
              <textarea
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                rows={2}
                className="w-full resize-none rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-txt"
              />
            </label>
          )}
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setAdding(false)}
              className="rounded-lg px-3 py-1.5 text-xs text-txt3 hover:text-txt"
            >
              Cancel
            </button>
            <button
              onClick={addNotif}
              className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white"
            >
              Add
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="mt-3 flex items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-2 text-xs text-txt3 transition hover:border-accent hover:text-accent"
        >
          <Plus className="h-3.5 w-3.5" /> Add a scheduled text
        </button>
      )}
    </section>
  );
}
