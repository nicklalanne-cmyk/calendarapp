"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  CalendarDays, CalendarRange, StickyNote, Link2, Home, Check, PenLine, Timer, Table2,
  Bell, ChevronRight, Sparkles, Copy, Download, KeyRound, Trash2, ShieldAlert, ListChecks,
  Mic, BookOpen, Zap, LayoutGrid, Wallet,
} from "lucide-react";
import clsx from "clsx";
import { useSettings } from "@/components/SettingsProvider";
import Reminders from "@/components/Reminders";
import { toast } from "@/lib/toast";
import { createClient } from "@/lib/supabase/client";

const VIEWS = [
  { id: "day", label: "Day" },
  { id: "week", label: "Week" },
  { id: "month", label: "Month" },
] as const;

const AGENDA_VIEWS = [
  { id: "day", label: "Day" },
  { id: "week", label: "Week" },
] as const;

const PAGES = [
  { href: "/app", label: "Planner", icon: CalendarDays, hint: "Calendar + tasks side by side" },
  { href: "/app/agenda", label: "Agenda", icon: CalendarRange, hint: "A scrolling list of what's next" },
  { href: "/app/tasks", label: "Tasks", icon: ListChecks, hint: "Every task, unscheduled first" },
  { href: "/app/notes", label: "Notes", icon: StickyNote, hint: "Your notebook" },
  { href: "/app/pages", label: "Pages", icon: Table2, hint: "Your CRM and project tables" },
  { href: "/app/focus", label: "Focus", icon: Timer, hint: "Pomodoro timer" },
  { href: "/app/finance", label: "Finance", icon: Wallet, hint: "Bank accounts, budgets, net worth" },
];

// Everything eligible for the mobile bottom bar's two configurable slots.
// The FAB, Thoughts, and Report buttons are fixed and always present, so this
// list only needs to cover pages that make sense as a quick one-tap jump.
const MOBILE_NAV_OPTIONS = [
  { href: "/app", label: "Planner", icon: CalendarDays },
  { href: "/app/agenda", label: "Agenda", icon: CalendarRange },
  { href: "/app/tasks", label: "Tasks", icon: ListChecks },
  { href: "/app/notes", label: "Notes", icon: StickyNote },
  { href: "/app/pages", label: "Pages", icon: Table2 },
  { href: "/app/notebooks", label: "Notebooks", icon: BookOpen },
  { href: "/app/focus", label: "Focus", icon: Timer },
  { href: "/app/automations", label: "Automations", icon: Zap },
  { href: "/app/plaud", label: "Plaud", icon: Mic },
  { href: "/app/finance", label: "Finance", icon: Wallet },
];
const MOBILE_NAV_MAX = 4;

type KeyMeta = { token_prefix: string; created_at: string; last_used_at: string | null };

// Common zones first, then whatever the browser reports (if different) so
// the picker always has the visitor's actual zone available even if it's
// not in this short list.
const COMMON_TIMEZONES = [
  "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles",
  "America/Anchorage", "Pacific/Honolulu", "America/Sao_Paulo",
  "Europe/London", "Europe/Paris", "Europe/Berlin", "Europe/Moscow",
  "Asia/Dubai", "Asia/Kolkata", "Asia/Shanghai", "Asia/Tokyo", "Asia/Singapore",
  "Australia/Sydney", "Pacific/Auckland", "UTC",
];

export default function SettingsView() {
  const { settings, update, ready } = useSettings();
  const supabase = createClient();
  const [saved, setSaved] = useState(false);
  const [keyMeta, setKeyMeta] = useState<KeyMeta | null>(null);
  const [keyLoading, setKeyLoading] = useState(true);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [timezone, setTimezoneState] = useState<string>(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
  );
  const [digestHour, setDigestHourState] = useState(8);
  const [tzLoaded, setTzLoaded] = useState(false);

  // These live in user_settings alongside the rest of the settings row, but
  // aren't part of SettingsProvider's synced shape — until now they were only
  // ever written as a side effect of turning push notifications on, with no
  // dedicated UI at all, so a user who wanted a digest at 6am instead of 8am
  // (or whose device timezone was ever wrong) had no way to fix it.
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("user_settings")
        .select("timezone, digest_hour")
        .maybeSingle();
      if (data?.timezone) setTimezoneState(data.timezone);
      if (typeof data?.digest_hour === "number") setDigestHourState(data.digest_hour);
      setTzLoaded(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveTimezone = async (tz: string) => {
    setTimezoneState(tz);
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    await supabase
      .from("user_settings")
      .upsert({ user_id: u.user.id, timezone: tz, updated_at: new Date().toISOString() });
    flash();
  };

  const saveDigestHour = async (hour: number) => {
    setDigestHourState(hour);
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    await supabase
      .from("user_settings")
      .upsert({ user_id: u.user.id, digest_hour: hour, updated_at: new Date().toISOString() });
    flash();
  };

  useEffect(() => {
    fetch("/api/skill/key")
      .then((r) => r.json())
      .then((j) => setKeyMeta(j.key ?? null))
      .catch(() => {})
      .finally(() => setKeyLoading(false));
  }, []);

  const generateKey = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/skill/key", { method: "POST" });
      const j = await res.json();
      if (!res.ok) return toast(j.error ?? "Couldn't generate a key", "error");
      setNewToken(j.token);
      setKeyMeta({ token_prefix: j.prefix, created_at: new Date().toISOString(), last_used_at: null });
    } finally {
      setBusy(false);
    }
  };

  const revokeKey = async () => {
    if (!confirm("Revoke this API key? Anything using it (Claude Code, Cowork, etc.) will stop working immediately.")) return;
    setBusy(true);
    try {
      const res = await fetch("/api/skill/key", { method: "DELETE" });
      const j = await res.json();
      if (!res.ok) return toast(j.error ?? "Couldn't revoke the key", "error");
      setKeyMeta(null);
      setNewToken(null);
      toast("API key revoked");
    } finally {
      setBusy(false);
    }
  };

  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deletingAccount, setDeletingAccount] = useState(false);

  const exportData = () => {
    // A plain link download would work too, but this way we get a real error
    // toast if the export fails instead of the browser silently opening a
    // JSON error blob in a new tab.
    (async () => {
      const res = await fetch("/api/account/export");
      if (!res.ok) return toast("Couldn't export your data", "error");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `cadence-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    })();
  };

  const deleteAccount = async () => {
    setDeletingAccount(true);
    try {
      const res = await fetch("/api/account/delete", { method: "POST" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) return toast(j.error ?? "Couldn't delete your account", "error");
      window.location.href = "/login";
    } finally {
      setDeletingAccount(false);
    }
  };

  const copyToken = () => {
    if (!newToken) return;
    navigator.clipboard.writeText(newToken).then(
      () => toast("Copied"),
      () => toast("Couldn't copy — select and copy manually", "error")
    );
  };

  const flash = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 1400);
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl p-6">
        <div className="mb-6 flex items-center gap-3">
          <h1 className="text-2xl font-semibold">Settings</h1>
          {saved && (
            <span className="flex items-center gap-1 text-xs text-success">
              <Check className="h-3.5 w-3.5" /> Saved
            </span>
          )}
        </div>

        <section className="mb-6 rounded-xl border border-border bg-surface p-4">
          <h2 className="text-sm font-semibold">Default calendar view</h2>
          <p className="mb-3 text-xs text-txt3">Which view the Planner opens in.</p>
          <div className="flex gap-2">
            {VIEWS.map((v) => (
              <button
                key={v.id}
                onClick={() => {
                  update({ default_view: v.id });
                  flash();
                }}
                className={clsx(
                  "flex-1 rounded-lg border px-3 py-2 text-sm transition",
                  settings.default_view === v.id
                    ? "border-accent bg-accent/10 text-accent"
                    : "border-border text-txt2 hover:bg-surface2"
                )}
              >
                {v.label}
              </button>
            ))}
          </div>
        </section>

        <section className="mb-6 rounded-xl border border-border bg-surface p-4">
          <h2 className="text-sm font-semibold">Default Agenda view</h2>
          <p className="mb-3 text-xs text-txt3">
            Which view Agenda opens in on desktop. On mobile, Agenda always starts on Day.
          </p>
          <div className="flex gap-2">
            {AGENDA_VIEWS.map((v) => (
              <button
                key={v.id}
                onClick={() => {
                  update({ agenda_view: v.id });
                  flash();
                }}
                className={clsx(
                  "flex-1 rounded-lg border px-3 py-2 text-sm transition",
                  settings.agenda_view === v.id
                    ? "border-accent bg-accent/10 text-accent"
                    : "border-border text-txt2 hover:bg-surface2"
                )}
              >
                {v.label}
              </button>
            ))}
          </div>
        </section>

        <section className="mb-6 rounded-xl border border-border bg-surface p-4">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold">
            <Home className="h-4 w-4" /> Home page
          </h2>
          <p className="mb-3 text-xs text-txt3">
            The page Cadence opens on when you launch it.
          </p>
          <div className="space-y-2">
            {PAGES.map((p) => {
              const Icon = p.icon;
              const active = settings.home_page === p.href;
              return (
                <button
                  key={p.href}
                  onClick={() => {
                    update({ home_page: p.href });
                    flash();
                  }}
                  className={clsx(
                    "flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition",
                    active ? "border-accent bg-accent/10" : "border-border hover:bg-surface2"
                  )}
                >
                  <Icon className={clsx("h-4 w-4 shrink-0", active ? "text-accent" : "text-txt3")} />
                  <div className="min-w-0 flex-1">
                    <div className={clsx("text-sm", active ? "text-accent" : "text-txt")}>{p.label}</div>
                    <div className="truncate text-[11px] text-txt3">{p.hint}</div>
                  </div>
                  {active && <Check className="h-4 w-4 shrink-0 text-accent" />}
                </button>
              );
            })}
          </div>
        </section>

        <section className="mb-6 rounded-xl border border-border bg-surface p-4">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold">
            <LayoutGrid className="h-4 w-4" /> Mobile bottom nav
          </h2>
          <p className="mb-3 text-xs text-txt3">
            Pick up to {MOBILE_NAV_MAX} pages for one-tap access at the bottom of the screen on
            mobile. Tap in the order you want them to appear; tap again to remove one.
            The + button, Thoughts, and Report stay put either way.
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {MOBILE_NAV_OPTIONS.map((p) => {
              const Icon = p.icon;
              const current = settings.mobile_nav ?? [];
              const idx = current.indexOf(p.href);
              const active = idx !== -1;
              const atMax = current.length >= MOBILE_NAV_MAX;
              return (
                <button
                  key={p.href}
                  disabled={!active && atMax}
                  onClick={() => {
                    const next = active
                      ? current.filter((h) => h !== p.href)
                      : [...current, p.href];
                    if (next.length === 0) return; // keep at least one
                    update({ mobile_nav: next });
                    flash();
                  }}
                  className={clsx(
                    "flex items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-sm transition disabled:cursor-not-allowed disabled:opacity-40",
                    active ? "border-accent bg-accent/10 text-accent" : "border-border text-txt2 hover:bg-surface2"
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{p.label}</span>
                  {active && (
                    <span className="shrink-0 rounded-full bg-accent/20 px-1.5 text-[10px] font-semibold tabular-nums text-accent">
                      {idx + 1}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </section>

        <section className="mb-6 rounded-xl border border-border bg-surface p-4">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <h2 className="flex items-center gap-1.5 text-sm font-semibold">
                <PenLine className="h-4 w-4" /> Handwriting
              </h2>
              <p className="mt-1 text-xs text-txt3">
                Adds a pen notepad to every note — write with the S Pen and convert it to
                text. Turn it off and notes stay plain text only.
              </p>
              {!settings.handwriting_enabled && (
                <p className="mt-1 text-xs text-txt3">
                  Existing handwriting isn’t deleted — it reappears if you switch this back on.
                </p>
              )}
            </div>
            <button
              role="switch"
              aria-checked={settings.handwriting_enabled}
              onClick={() => {
                update({ handwriting_enabled: !settings.handwriting_enabled });
                flash();
              }}
              className={clsx(
                "relative mt-0.5 h-7 w-12 shrink-0 rounded-full transition",
                settings.handwriting_enabled ? "bg-accent" : "bg-surface3"
              )}
            >
              <span
                className={clsx(
                  "absolute top-1 h-5 w-5 rounded-full bg-white transition-all",
                  settings.handwriting_enabled ? "left-6" : "left-1"
                )}
              />
            </button>
          </div>
        </section>


        <section className="mb-6 rounded-xl border border-border bg-surface p-4">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <h2 className="flex items-center gap-1.5 text-sm font-semibold">
                <Bell className="h-4 w-4" /> Notifications
              </h2>
              <p className="mt-1 text-xs text-txt3">
                Background reminders that arrive even when Cadence is closed.
              </p>
            </div>
            <Reminders variant="row" />
          </div>
          {tzLoaded && (
            <div className="mt-4 grid grid-cols-2 gap-3 border-t border-border pt-3">
              <label className="block">
                <span className="mb-1 block text-xs text-txt3">Timezone</span>
                <select
                  value={timezone}
                  onChange={(e) => saveTimezone(e.target.value)}
                  className="w-full rounded-lg border border-border bg-surface2 px-2 py-1.5 text-sm text-txt"
                >
                  {[...new Set([timezone, ...COMMON_TIMEZONES])].map((tz) => (
                    <option key={tz} value={tz}>
                      {tz}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-txt3">Daily digest hour</span>
                <select
                  value={digestHour}
                  onChange={(e) => saveDigestHour(parseInt(e.target.value, 10))}
                  className="w-full rounded-lg border border-border bg-surface2 px-2 py-1.5 text-sm text-txt"
                >
                  {Array.from({ length: 24 }, (_, h) => (
                    <option key={h} value={h}>
                      {h === 0 ? "12:00 AM" : h < 12 ? `${h}:00 AM` : h === 12 ? "12:00 PM" : `${h - 12}:00 PM`}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
        </section>

        <section className="mb-6 rounded-xl border border-border bg-surface p-4">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold">
            <Sparkles className="h-4 w-4" /> Claude Skill
          </h2>
          <p className="mb-3 text-xs text-txt3">
            Let Claude (Claude Code, Claude Desktop, Cowork, claude.ai) create, edit, and
            delete your tasks, calendar events, notes, and automations directly — from
            outside Cadence. Generate a key, download the Skill, and add the key as the
            <code className="mx-1 rounded bg-surface2 px-1">CADENCE_API_TOKEN</code>
            environment variable wherever Claude is running.
          </p>

          {newToken && (
            <div className="mb-3 rounded-lg border border-accent/40 bg-accent/5 p-3">
              <p className="mb-1.5 text-xs font-medium text-txt">
                Copy this now — it won't be shown again.
              </p>
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-md border border-border bg-surface px-2 py-1.5 text-xs">
                  {newToken}
                </code>
                <button
                  onClick={copyToken}
                  className="flex shrink-0 items-center gap-1 rounded-md bg-accent px-2 py-1.5 text-xs font-medium text-white hover:bg-accentSoft"
                >
                  <Copy className="h-3.5 w-3.5" /> Copy
                </button>
              </div>
            </div>
          )}

          {!keyLoading && (
            <div className="mb-3 flex items-center gap-3 rounded-lg border border-border px-3 py-2.5">
              <KeyRound className="h-4 w-4 shrink-0 text-txt3" />
              <div className="min-w-0 flex-1">
                {keyMeta ? (
                  <>
                    <div className="truncate text-sm text-txt">{keyMeta.token_prefix}…</div>
                    <div className="text-[11px] text-txt3">
                      Created {new Date(keyMeta.created_at).toLocaleDateString()}
                      {keyMeta.last_used_at
                        ? ` · last used ${new Date(keyMeta.last_used_at).toLocaleDateString()}`
                        : " · never used yet"}
                    </div>
                  </>
                ) : (
                  <div className="text-sm text-txt3">No API key yet</div>
                )}
              </div>
              {keyMeta && (
                <button
                  onClick={revokeKey}
                  disabled={busy}
                  className="flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-1.5 text-xs text-txt2 hover:border-danger hover:text-danger disabled:opacity-50"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Revoke
                </button>
              )}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              onClick={generateKey}
              disabled={busy}
              className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white hover:bg-accentSoft disabled:opacity-50"
            >
              <KeyRound className="h-4 w-4" /> {keyMeta ? "Regenerate API key" : "Generate API key"}
            </button>
            <a
              href="/api/skill/download"
              download="SKILL.md"
              className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm text-txt2 hover:bg-surface2"
            >
              <Download className="h-4 w-4" /> Download Skill (SKILL.md)
            </a>
          </div>
        </section>

        <section className="rounded-xl border border-border bg-surface p-4">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold">
            <Link2 className="h-4 w-4" /> Calendars
          </h2>
          <p className="mb-3 text-xs text-txt3">
            Connect or manage the Google accounts Cadence syncs with.
          </p>
          <Link
            href="/app/accounts"
            className="flex w-full items-center gap-3 rounded-lg border border-border px-3 py-2.5 text-left transition hover:bg-surface2"
          >
            <Link2 className="h-4 w-4 shrink-0 text-txt3" />
            <span className="min-w-0 flex-1 text-sm text-txt">Connected calendars</span>
            <ChevronRight className="h-4 w-4 shrink-0 text-txt3" />
          </Link>
        </section>

        <section className="mb-6 mt-6 rounded-xl border border-border bg-surface p-4">
          <h2 className="text-sm font-semibold">Your data</h2>
          <p className="mb-3 text-xs text-txt3">
            Download everything Cadence has stored for you — tasks, notes, notebooks,
            automations, and settings — as a single JSON file.
          </p>
          <button
            onClick={exportData}
            className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm text-txt2 hover:bg-surface2"
          >
            <Download className="h-4 w-4" /> Export my data
          </button>
        </section>

        <section className="rounded-xl border border-danger/30 bg-danger/5 p-4">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-danger">
            <ShieldAlert className="h-4 w-4" /> Danger zone
          </h2>
          <p className="mb-3 text-xs text-txt3">
            Permanently deletes your account and everything in it — tasks, notes, notebooks,
            automations, connected Google accounts. This can't be undone.
          </p>
          <label className="mb-2 block text-xs text-txt3">
            Type <span className="font-mono font-semibold text-txt">DELETE</span> to confirm
          </label>
          <div className="flex items-center gap-2">
            <input
              value={deleteConfirm}
              onChange={(e) => setDeleteConfirm(e.target.value)}
              placeholder="DELETE"
              className="w-32 rounded-lg border border-border bg-bg px-2.5 py-2 text-sm outline-none focus:border-danger"
            />
            <button
              onClick={deleteAccount}
              disabled={deleteConfirm !== "DELETE" || deletingAccount}
              className="flex items-center gap-1.5 rounded-lg bg-danger px-3 py-2 text-sm font-medium text-white hover:bg-danger/90 disabled:opacity-40"
            >
              <Trash2 className="h-4 w-4" />
              {deletingAccount ? "Deleting…" : "Delete my account"}
            </button>
          </div>
        </section>

        {!ready && <p className="mt-4 text-xs text-txt3">Loading your settings…</p>}
      </div>
    </div>
  );
}
