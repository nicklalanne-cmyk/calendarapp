"use client";

import { useEffect, useState } from "react";
import { CalendarDays, CalendarRange, StickyNote, Link2, Home, Check, PenLine, Timer, Table2 } from "lucide-react";
import clsx from "clsx";
import { useSettings } from "@/components/SettingsProvider";

const VIEWS = [
  { id: "day", label: "Day" },
  { id: "week", label: "Week" },
  { id: "month", label: "Month" },
] as const;

const PAGES = [
  { href: "/app", label: "Planner", icon: CalendarDays, hint: "Calendar + tasks side by side" },
  { href: "/app/agenda", label: "Agenda", icon: CalendarRange, hint: "A scrolling list of what's next" },
  { href: "/app/notes", label: "Notes", icon: StickyNote, hint: "Your notebook" },
  { href: "/app/pages", label: "Pages", icon: Table2, hint: "Your CRM and project tables" },
  { href: "/app/focus", label: "Focus", icon: Timer, hint: "Pomodoro timer" },
];

export default function SettingsView() {
  const { settings, update, ready } = useSettings();
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setTheme((document.documentElement.getAttribute("data-theme") as "dark" | "light") || "dark");
  }, []);

  const flash = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 1400);
  };

  const setTheme_ = (t: "dark" | "light") => {
    document.documentElement.setAttribute("data-theme", t);
    try {
      localStorage.setItem("cadence-theme", t);
    } catch {
      /* ignore */
    }
    setTheme(t);
    flash();
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

        <section className="rounded-xl border border-border bg-surface p-4">
          <h2 className="text-sm font-semibold">Appearance</h2>
          <p className="mb-3 text-xs text-txt3">This one is saved on this device.</p>
          <div className="flex gap-2">
            {(["dark", "light"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTheme_(t)}
                className={clsx(
                  "flex-1 rounded-lg border px-3 py-2 text-sm capitalize transition",
                  theme === t
                    ? "border-accent bg-accent/10 text-accent"
                    : "border-border text-txt2 hover:bg-surface2"
                )}
              >
                {t}
              </button>
            ))}
          </div>
        </section>

        {!ready && <p className="mt-4 text-xs text-txt3">Loading your settings…</p>}
      </div>
    </div>
  );
}
