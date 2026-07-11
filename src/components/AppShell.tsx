"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  CalendarDays,
  CalendarRange,
  StickyNote,
  Plus,
  LogOut,
  Link2,
  Sun,
  Moon,
  Settings,
  Sparkles,
  MoreHorizontal,
  Table2,
  Timer,
  X,
} from "lucide-react";
import CommandBar from "@/components/CommandBar";
import Reminders from "@/components/Reminders";
import Toaster from "@/components/Toaster";
import Assistant from "@/components/Assistant";
import QuickFab from "@/components/QuickFab";
import clsx from "clsx";

export default function AppShell({
  email,
  children,
}: {
  email: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [cmdOpen, setCmdOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  useEffect(() => {
    const t = (document.documentElement.getAttribute("data-theme") as "dark" | "light") || "dark";
    setTheme(t);
  }, []);

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("cadence-theme", next);
    } catch {
      /* ignore */
    }
    setTheme(next);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCmdOpen((v) => !v);
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setAiOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // desktop rail shows everything; the phone's bottom bar shows the first four
  const nav = [
    { href: "/app", label: "Planner", icon: CalendarDays },
    { href: "/app/agenda", label: "Agenda", icon: CalendarRange },
    { href: "/app/notes", label: "Notes", icon: StickyNote },
    { href: "/app/pages", label: "Pages", icon: Table2 },
    { href: "/app/focus", label: "Focus", icon: Timer },
    { href: "/app/accounts", label: "Calendars", icon: Link2 },
  ];
  const mobileNav = nav.slice(0, 4);

  // FAB actions broadcast to whatever page is mounted; pages listen and open their own modal.
  const fire = (name: string) => window.dispatchEvent(new CustomEvent(name));
  const newTask = () => {
    if (pathname !== "/app") router.push("/app");
    setTimeout(() => fire("cadence:new-task"), pathname !== "/app" ? 350 : 0);
  };
  const newEvent = () => {
    if (pathname !== "/app") router.push("/app");
    setTimeout(() => fire("cadence:new-event"), pathname !== "/app" ? 350 : 0);
  };
  const newNote = () => router.push("/app/notes?new=1");
  const voiceMemo = () => router.push("/app/notes?record=1");

  const ThemeButton = (
    <button
      onClick={toggleTheme}
      title={theme === "dark" ? "Switch to light" : "Switch to dark"}
      className="flex h-10 w-10 items-center justify-center rounded-xl text-txt3 transition hover:bg-surface hover:text-txt"
    >
      {theme === "dark" ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
    </button>
  );

  const SignOut = (
    <form action="/auth/signout" method="post">
      <button
        type="submit"
        title="Sign out"
        className="flex h-10 w-10 items-center justify-center rounded-xl text-txt3 transition hover:bg-surface hover:text-danger"
      >
        <LogOut className="h-5 w-5" />
      </button>
    </form>
  );

  return (
    <div className="flex h-[100svh] w-full overflow-hidden bg-bg text-txt">
      {/* ---------------- desktop rail ---------------- */}
      <nav className="hidden w-16 shrink-0 flex-col items-center gap-1 border-r border-border py-4 md:flex">
        <div className="mb-4 flex h-9 w-9 items-center justify-center rounded-xl bg-accent/20 text-accent">
          <CalendarDays className="h-5 w-5" />
        </div>
        {nav.map((n) => {
          const active =
            n.href === "/app" ? pathname === "/app" : pathname.startsWith(n.href);
          const Icon = n.icon;
          return (
            <Link
              key={n.href}
              href={n.href}
              title={n.label}
              className={clsx(
                "flex h-11 w-11 items-center justify-center rounded-xl transition",
                active ? "bg-surface3 text-txt" : "text-txt3 hover:bg-surface hover:text-txt"
              )}
            >
              <Icon className="h-5 w-5" />
            </Link>
          );
        })}
        <button
          title="Quick add (⌘K)"
          onClick={() => setCmdOpen(true)}
          className="mt-2 flex h-11 w-11 items-center justify-center rounded-xl text-txt3 transition hover:bg-surface hover:text-txt"
        >
          <Plus className="h-5 w-5" />
        </button>
        <button
          title="Ask Cadence (⌘J)"
          onClick={() => setAiOpen(true)}
          className={clsx(
            "flex h-11 w-11 items-center justify-center rounded-xl transition",
            aiOpen ? "bg-accent/20 text-accent" : "text-txt3 hover:bg-surface hover:text-accent"
          )}
        >
          <Sparkles className="h-5 w-5" />
        </button>
        <div className="mt-auto flex flex-col items-center gap-1">
          <Link
            href="/app/settings"
            title="Settings"
            className={clsx(
              "flex h-10 w-10 items-center justify-center rounded-xl transition",
              pathname === "/app/settings"
                ? "bg-surface3 text-txt"
                : "text-txt3 hover:bg-surface hover:text-txt"
            )}
          >
            <Settings className="h-5 w-5" />
          </Link>
          <Reminders />
          {ThemeButton}
          <div
            title={email}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-surface3 text-xs font-semibold uppercase text-txt2"
          >
            {email.slice(0, 1) || "?"}
          </div>
          {SignOut}
        </div>
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* ---------------- mobile header ---------------- */}
        <header className="flex h-14 shrink-0 items-center gap-2 px-3 md:hidden">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/20 text-accent">
            <CalendarDays className="h-[18px] w-[18px]" />
          </div>
          <span className="text-base font-semibold">Cadence</span>
          <div className="ml-auto flex items-center gap-1">
            <button
              onClick={() => setAiOpen(true)}
              aria-label="Ask Cadence"
              className="flex h-11 w-11 items-center justify-center rounded-xl text-accent active:bg-surface2"
            >
              <Sparkles className="h-[22px] w-[22px]" />
            </button>
            <button
              onClick={() => setSheet(true)}
              aria-label="More"
              className="flex h-11 w-11 items-center justify-center rounded-xl text-txt2 active:bg-surface2"
            >
              <MoreHorizontal className="h-[22px] w-[22px]" />
            </button>
          </div>
        </header>

        <main className="min-h-0 w-full min-w-0 flex-1 overflow-hidden">{children}</main>

        {/* ---------------- mobile bottom nav ---------------- */}
        <nav
          className="flex shrink-0 items-center justify-around border-t border-border bg-bg px-1 pt-1.5 md:hidden"
          style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }}
        >
          {mobileNav.slice(0, 2).map((n) => (
            <NavTab key={n.href} {...n} active={pathname.startsWith(n.href) && (n.href !== "/app" || pathname === "/app")} />
          ))}

          <QuickFab
            onNewTask={newTask}
            onNewEvent={newEvent}
            onNewNote={newNote}
            onVoiceMemo={voiceMemo}
          />

          {mobileNav.slice(2).map((n) => (
            <NavTab key={n.href} {...n} active={pathname.startsWith(n.href)} />
          ))}
        </nav>
      </div>

      {/* ---------------- mobile overflow sheet ---------------- */}
      {sheet && (
        <div className="fixed inset-0 z-50 md:hidden" onClick={() => setSheet(false)}>
          <div className="absolute inset-0 bg-black/50" />
          <div
            className="absolute inset-x-0 bottom-0 rounded-t-2xl border-t border-border bg-surface p-4 pb-8"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <span className="truncate text-sm text-txt3">{email}</span>
              <button onClick={() => setSheet(false)} className="rounded p-1 text-txt3">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-1">
              <SheetRow
                icon={<Timer className="h-[18px] w-[18px]" />}
                label="Focus timer"
                onClick={() => {
                  setSheet(false);
                  router.push("/app/focus");
                }}
              />
              <SheetRow
                icon={<Link2 className="h-[18px] w-[18px]" />}
                label="Calendars"
                onClick={() => {
                  setSheet(false);
                  router.push("/app/accounts");
                }}
              />
              <SheetRow
                icon={<Settings className="h-[18px] w-[18px]" />}
                label="Settings"
                onClick={() => {
                  setSheet(false);
                  router.push("/app/settings");
                }}
              />
              <SheetRow
                icon={theme === "dark" ? <Sun className="h-[18px] w-[18px]" /> : <Moon className="h-[18px] w-[18px]" />}
                label={theme === "dark" ? "Light theme" : "Dark theme"}
                onClick={toggleTheme}
              />
              <div className="flex items-center gap-3 rounded-xl px-3 py-2 text-[15px]">
                <Reminders />
                <span className="text-txt2">Reminders</span>
              </div>
              <form action="/auth/signout" method="post">
                <button
                  type="submit"
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-3.5 text-left text-[15px] text-danger"
                >
                  <LogOut className="h-[18px] w-[18px]" />
                  Sign out
                </button>
              </form>
            </div>
          </div>
        </div>
      )}

      <CommandBar open={cmdOpen} onClose={() => setCmdOpen(false)} />
      <Assistant open={aiOpen} onClose={() => setAiOpen(false)} />
      <Toaster />
    </div>
  );
}

function NavTab({
  href,
  label,
  icon: Icon,
  active,
}: {
  href: string;
  label: string;
  icon: React.ElementType;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={clsx(
        "flex flex-1 flex-col items-center gap-1 rounded-lg py-2 text-[11px] font-medium transition active:opacity-60",
        active ? "text-accent" : "text-txt3"
      )}
    >
      <Icon className={clsx("h-6 w-6", active && "fill-accent/15")} />
      {label}
    </Link>
  );
}

function SheetRow({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-xl px-3 py-3.5 text-left text-[15px] text-txt2 active:bg-surface2"
    >
      {icon}
      {label}
    </button>
  );
}
