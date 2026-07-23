"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  CalendarDays,
  CalendarRange,
  StickyNote,
  LogOut,
  Link2,
  Settings,
  Sparkles,
  Menu,
  Table2,
  BookOpen,
  Timer,
  Zap,
  MessageSquarePlus,
  Inbox,
  Search,
  X,
  PanelLeftClose,
  PanelLeftOpen,
  Mic,
  Brain,
  ChevronDown,
  ChevronUp,
  ListChecks,
  Wallet,
} from "lucide-react";
import CommandBar from "@/components/CommandBar";
import Reminders from "@/components/Reminders";
import Toaster from "@/components/Toaster";
import Assistant from "@/components/Assistant";
import QuickFab from "@/components/QuickFab";
import FeedbackOverlay from "@/components/feedback/FeedbackOverlay";
import PullToRefresh from "@/components/PullToRefresh";
import { useAdminInbox } from "@/components/feedback/useAdminInbox";
import { useSettings } from "@/components/SettingsProvider";
import clsx from "clsx";

// Every page eligible for the mobile bottom bar's configurable slots — kept
// in sync with MOBILE_NAV_OPTIONS in SettingsView.tsx (that file owns the
// picker UI; this is just the lookup used to render whatever the user chose).
const MOBILE_NAV_CATALOG = [
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
  const [feedback, setFeedback] = useState(false);
  const { isAdmin, openCount } = useAdminInbox();
  const { settings } = useSettings();
  const [railExpanded, setRailExpanded] = useState(false);
  const [thoughtsOpen, setThoughtsOpen] = useState(false);
  const [thoughtsSheet, setThoughtsSheet] = useState(false);
  // Rendered blank on the server/first client pass and filled in after mount
  // so the browser's local timezone (used to format the build time) can't
  // cause a hydration mismatch against the server's.
  const [buildLabel, setBuildLabel] = useState<string | null>(null);
  // On mobile, the on-screen keyboard shrinks the visualViewport but not
  // window.innerHeight — a >120px gap between the two is a reliable "keyboard
  // is up" signal. The bottom nav (and the FAB riding above it) otherwise sits
  // right on top of whatever input/modal opened the keyboard, since it's
  // pinned to the bottom of the now-shorter visible area instead of getting
  // pushed offscreen. Hiding it while the keyboard is open reclaims that
  // space instead of covering the screen.
  const [keyboardOpen, setKeyboardOpen] = useState(false);

  useEffect(() => {
    const sha = (process.env.NEXT_PUBLIC_BUILD_SHA || "dev").slice(0, 7);
    const iso = process.env.NEXT_PUBLIC_BUILD_TIME;
    const when = iso
      ? new Date(iso).toLocaleString(undefined, {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        })
      : null;
    setBuildLabel(`v${sha}${when ? ` · updated ${when}` : ""}`);
  }, []);

  useEffect(() => {
    try {
      setRailExpanded(localStorage.getItem("cadence-rail-expanded") === "1");
      setThoughtsOpen(localStorage.getItem("cadence-thoughts-open") === "1");
    } catch {
      /* ignore */
    }
  }, []);

  const THOUGHTS_HREFS = ["/app/notes", "/app/pages", "/app/plaud"];

  // Auto-expand the group whenever you're actually on one of its pages, so
  // navigating there directly (e.g. via search or a bookmark) doesn't leave
  // the sidebar looking like nothing is selected.
  useEffect(() => {
    if (THOUGHTS_HREFS.some((h) => pathname.startsWith(h))) {
      setThoughtsOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  const toggleThoughts = () => {
    setThoughtsOpen((v) => {
      const next = !v;
      try {
        localStorage.setItem("cadence-thoughts-open", next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  const toggleRail = () => {
    setRailExpanded((v) => {
      const next = !v;
      try {
        localStorage.setItem("cadence-rail-expanded", next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  // Mobile keyboards resizing the layout viewport (instead of just overlaying it) is what
  // caused the notes editor to look "frozen"/glitched: the shell was pinned to 100svh, and
  // on several Android/iOS browsers that unit doesn't reliably track the keyboard opening,
  // so the fixed-height flex shell and the focused textarea inside it fight over layout.
  // Track the real visible height via visualViewport and drive the shell from that instead,
  // falling back to 100svh (set in the className below) wherever visualViewport is missing.
  useEffect(() => {
    const setAppHeight = () => {
      const vv = window.visualViewport;
      const h = vv ? vv.height : window.innerHeight;
      document.documentElement.style.setProperty("--app-height", `${h}px`);
      setKeyboardOpen(vv ? window.innerHeight - vv.height > 120 : false);
    };
    setAppHeight();
    window.visualViewport?.addEventListener("resize", setAppHeight);
    window.addEventListener("resize", setAppHeight);
    return () => {
      window.visualViewport?.removeEventListener("resize", setAppHeight);
      window.removeEventListener("resize", setAppHeight);
    };
  }, []);

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

  // desktop rail nav; the phone's bottom bar shows a user-configurable subset
  // (see MOBILE_NAV_CATALOG / mobileNav below). Calendars now lives in
  // Settings, and Search/Assistant moved to the top-right utility bar, so the
  // rail itself only has to hold the pages.
  const thoughtsChildren = [
    { href: "/app/tasks", label: "Tasks", icon: ListChecks },
    { href: "/app/notes", label: "Notes", icon: StickyNote },
    { href: "/app/pages", label: "Pages", icon: Table2 },
    { href: "/app/plaud", label: "Plaud", icon: Mic },
  ];
  type NavLink = { href: string; label: string; icon: React.ElementType };
  type NavGroup = { group: string; label: string; icon: React.ElementType; children: NavLink[] };
  const nav: (NavLink | NavGroup)[] = [
    { href: "/app", label: "Planner", icon: CalendarDays },
    { href: "/app/agenda", label: "Agenda", icon: CalendarRange },
    { group: "thoughts", label: "Thoughts", icon: Brain, children: thoughtsChildren },
    { href: "/app/notebooks", label: "Notebooks", icon: BookOpen },
    { href: "/app/focus", label: "Focus", icon: Timer },
    { href: "/app/automations", label: "Automations", icon: Zap },
    { href: "/app/finance", label: "Finance", icon: Wallet },
  ];
  // User-configurable (Settings → Mobile bottom nav); falls back to the
  // original Planner/Agenda pair if nothing's chosen yet. Thoughts opens its
  // own sheet, so it's never part of this configurable set.
  const mobileNavHrefs = settings.mobile_nav && settings.mobile_nav.length > 0 ? settings.mobile_nav : ["/app", "/app/agenda"];
  const mobileNav = mobileNavHrefs
    .map((href) => MOBILE_NAV_CATALOG.find((i) => i.href === href))
    .filter((i): i is (typeof MOBILE_NAV_CATALOG)[number] => Boolean(i));

  // FAB actions broadcast to whatever page is mounted; pages listen and open their own modal.
  const fire = (name: string) => window.dispatchEvent(new CustomEvent(name));
  // Agenda has its own "new task" handling (AgendaView listens for
  // cadence:new-task and opens its modal pre-filled with whatever day is
  // currently selected there) — so the FAB shouldn't yank you back to
  // Planner (and lose that day) when you're already on Agenda. Every other
  // page still falls back to Planner, since only Planner/Agenda know how to
  // handle this event themselves.
  const handlesNewTaskLocally = (p: string) => p === "/app" || p.startsWith("/app/agenda");
  const newTask = () => {
    const local = handlesNewTaskLocally(pathname);
    if (!local) router.push("/app");
    setTimeout(() => fire("cadence:new-task"), local ? 0 : 350);
  };
  const newEvent = () => {
    if (pathname !== "/app") router.push("/app");
    setTimeout(() => fire("cadence:new-event"), pathname !== "/app" ? 350 : 0);
  };
  const newNote = () => router.push("/app/notes?new=1");
  const voiceMemo = () => router.push("/app/notes?record=1");

  const SignOut = (
    <form action="/auth/signout" method="post">
      <button
        type="submit"
        title={railExpanded ? undefined : "Sign out"}
        className={clsx(
          "flex h-10 items-center rounded-xl text-txt3 transition hover:bg-surface hover:text-danger",
          railExpanded ? "w-full gap-3 px-3" : "w-10 justify-center"
        )}
      >
        <LogOut className="h-5 w-5 shrink-0" />
        {railExpanded && <span className="truncate text-sm">Sign out</span>}
      </button>
    </form>
  );

  return (
    <div
      className="flex h-[100svh] w-full overflow-hidden bg-bg text-txt"
      style={{ height: "var(--app-height, 100svh)" }}
    >
      {/* ---------------- desktop rail ---------------- */}
      <nav
        className={clsx(
          "hidden shrink-0 flex-col gap-1 border-r border-border py-4 transition-[width] duration-150 lg:flex",
          railExpanded ? "w-56 items-stretch px-2" : "w-16 items-center"
        )}
      >
        <div className={clsx("mb-1 flex items-center gap-2", railExpanded ? "px-1" : "justify-center")}>
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent/20 text-accent">
            <CalendarDays className="h-5 w-5" />
          </div>
          {railExpanded && <span className="truncate text-sm font-semibold">Cadence</span>}
        </div>

        <button
          onClick={toggleRail}
          title={railExpanded ? "Collapse sidebar" : "Expand sidebar"}
          className={clsx(
            "mb-3 flex h-9 items-center rounded-lg text-txt3 transition hover:bg-surface hover:text-txt",
            railExpanded ? "w-full gap-3 px-3" : "w-9 justify-center"
          )}
        >
          {railExpanded ? (
            <PanelLeftClose className="h-4 w-4 shrink-0" />
          ) : (
            <PanelLeftOpen className="h-4 w-4 shrink-0" />
          )}
          {railExpanded && <span className="truncate text-xs">Collapse</span>}
        </button>

        {nav.map((n) => {
          if ("group" in n) {
            const Icon = n.icon;
            const groupActive = n.children.some((c) => pathname.startsWith(c.href));
            return (
              <div key={n.group}>
                <button
                  onClick={() => {
                    if (!railExpanded) setRailExpanded(true);
                    toggleThoughts();
                  }}
                  title={railExpanded ? undefined : n.label}
                  className={clsx(
                    "flex h-11 w-full items-center rounded-xl transition",
                    railExpanded ? "gap-3 px-3" : "w-11 justify-center",
                    groupActive ? "bg-surface3 text-txt" : "text-txt3 hover:bg-surface hover:text-txt"
                  )}
                >
                  <Icon className="h-5 w-5 shrink-0" />
                  {railExpanded && (
                    <>
                      <span className="truncate text-sm">{n.label}</span>
                      {thoughtsOpen ? (
                        <ChevronUp className="ml-auto h-4 w-4 shrink-0" />
                      ) : (
                        <ChevronDown className="ml-auto h-4 w-4 shrink-0" />
                      )}
                    </>
                  )}
                </button>
                {railExpanded && thoughtsOpen && (
                  <div className="ml-2 flex flex-col gap-1 border-l border-border pl-2">
                    {n.children.map((c) => {
                      const cActive = pathname.startsWith(c.href);
                      const CIcon = c.icon;
                      return (
                        <Link
                          key={c.href}
                          href={c.href}
                          className={clsx(
                            "flex h-9 items-center gap-3 rounded-lg px-3 transition",
                            cActive ? "bg-surface3 text-txt" : "text-txt3 hover:bg-surface hover:text-txt"
                          )}
                        >
                          <CIcon className="h-4 w-4 shrink-0" />
                          <span className="truncate text-sm">{c.label}</span>
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          }
          const active =
            n.href === "/app" ? pathname === "/app" : pathname.startsWith(n.href);
          const Icon = n.icon;
          return (
            <Link
              key={n.href}
              href={n.href}
              title={railExpanded ? undefined : n.label}
              className={clsx(
                "flex h-11 items-center rounded-xl transition",
                railExpanded ? "w-full gap-3 px-3" : "w-11 justify-center",
                active ? "bg-surface3 text-txt" : "text-txt3 hover:bg-surface hover:text-txt"
              )}
            >
              <Icon className="h-5 w-5 shrink-0" />
              {railExpanded && <span className="truncate text-sm">{n.label}</span>}
            </Link>
          );
        })}

        <div className={clsx("mt-auto flex flex-col gap-1", railExpanded ? "items-stretch" : "items-center")}>
          {isAdmin && (
            <Link
              href="/app/feedback"
              title={railExpanded ? undefined : `Feedback inbox${openCount ? ` — ${openCount} open` : ""}`}
              className={clsx(
                "relative flex h-10 items-center rounded-xl transition",
                railExpanded ? "w-full gap-3 px-3" : "w-10 justify-center",
                pathname === "/app/feedback"
                  ? "bg-surface3 text-txt"
                  : "text-txt3 hover:bg-surface hover:text-txt"
              )}
            >
              <Inbox className="h-5 w-5 shrink-0" />
              {railExpanded && <span className="truncate text-sm">Feedback inbox</span>}
              {openCount > 0 && (
                <span
                  className={clsx(
                    "flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold text-white",
                    railExpanded ? "ml-auto" : "absolute -right-0.5 -top-0.5"
                  )}
                >
                  {openCount > 9 ? "9+" : openCount}
                </span>
              )}
            </Link>
          )}
          <button
            onClick={() => setFeedback(true)}
            title={railExpanded ? undefined : "Report a bug or request a feature"}
            className={clsx(
              "flex h-10 items-center rounded-xl text-txt3 transition hover:bg-surface hover:text-accent",
              railExpanded ? "w-full gap-3 px-3" : "w-10 justify-center"
            )}
          >
            <MessageSquarePlus className="h-5 w-5 shrink-0" />
            {railExpanded && <span className="truncate text-sm">Report</span>}
          </button>
          <Link
            href="/app/settings"
            title={railExpanded ? undefined : "Settings"}
            className={clsx(
              "flex h-10 items-center rounded-xl transition",
              railExpanded ? "w-full gap-3 px-3" : "w-10 justify-center",
              pathname === "/app/settings"
                ? "bg-surface3 text-txt"
                : "text-txt3 hover:bg-surface hover:text-txt"
            )}
          >
            <Settings className="h-5 w-5 shrink-0" />
            {railExpanded && <span className="truncate text-sm">Settings</span>}
          </Link>
          <div
            title={railExpanded ? undefined : email}
            className={clsx(
              "flex h-10 items-center rounded-xl",
              railExpanded ? "w-full gap-3 px-3" : "w-10 justify-center"
            )}
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface3 text-xs font-semibold uppercase text-txt2">
              {email.slice(0, 1) || "?"}
            </div>
            {railExpanded && <span className="min-w-0 flex-1 truncate text-xs text-txt3">{email}</span>}
          </div>
          {SignOut}
        </div>
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* ---------------- desktop utility bar: search + assistant, always top-right ---------------- */}
        <div className="hidden h-12 shrink-0 items-center justify-end gap-1 border-b border-border px-3 lg:flex">
          {buildLabel && (
            <span className="mr-auto select-none text-[10px] text-txt3/50" title="Build version and when this deploy went out">
              {buildLabel}
            </span>
          )}
          <button
            onClick={() => setCmdOpen(true)}
            title="Search & quick add (⌘K)"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-txt3 transition hover:bg-surface hover:text-txt"
          >
            <Search className="h-[18px] w-[18px]" />
          </button>
          <button
            onClick={() => setAiOpen((v) => !v)}
            title="Ask Cadence (⌘J)"
            className={clsx(
              "flex h-9 w-9 items-center justify-center rounded-lg transition",
              aiOpen ? "bg-accent/20 text-accent" : "text-txt3 hover:bg-surface hover:text-accent"
            )}
          >
            <Sparkles className="h-[18px] w-[18px]" />
          </button>
        </div>

        {/* ---------------- mobile header ---------------- */}
        <header className="flex h-14 shrink-0 items-center gap-2 px-3 lg:hidden">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/20 text-accent">
            <CalendarDays className="h-[18px] w-[18px]" />
          </div>
          <span className="text-base font-semibold">Cadence</span>
          {buildLabel && (
            <span className="select-none truncate text-[9px] text-txt3/50" title="Build version and when this deploy went out">
              {buildLabel}
            </span>
          )}
          <div className="ml-auto flex items-center gap-1">
            <button
              onClick={() => setCmdOpen(true)}
              aria-label="Search"
              className="flex h-11 w-11 items-center justify-center rounded-xl text-txt2 active:bg-surface2"
            >
              <Search className="h-[22px] w-[22px]" />
            </button>
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
              <Menu className="h-[22px] w-[22px]" />
            </button>
          </div>
        </header>

        <main className="min-h-0 w-full min-w-0 flex-1 overflow-hidden">
          <PullToRefresh>{children}</PullToRefresh>
        </main>

        {/* ---------------- mobile bottom nav ---------------- */}
        <nav
          className={clsx(
            "shrink-0 items-center justify-around border-t border-border bg-bg px-1 pt-1.5 lg:hidden",
            keyboardOpen ? "hidden" : "flex"
          )}
          style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }}
        >
          {mobileNav.map((n) => (
            <NavTab key={n.href} {...n} active={pathname.startsWith(n.href) && (n.href !== "/app" || pathname === "/app")} />
          ))}

          <QuickFab
            onNewTask={newTask}
            onNewEvent={newEvent}
            onNewNote={newNote}
            onVoiceMemo={voiceMemo}
          />

          <button
            onClick={() => setThoughtsSheet(true)}
            className={clsx(
              "flex flex-1 flex-col items-center gap-1 rounded-lg py-2 text-[11px] font-medium transition active:opacity-60",
              THOUGHTS_HREFS.some((h) => pathname.startsWith(h)) ? "text-accent" : "text-txt3"
            )}
          >
            <Brain className={clsx("h-6 w-6", THOUGHTS_HREFS.some((h) => pathname.startsWith(h)) && "fill-accent/15")} />
            Thoughts
          </button>

          {/* Overlay, not a route — so it never interrupts what you were doing. */}
          <button
            onClick={() => setFeedback(true)}
            className="flex flex-1 flex-col items-center gap-1 rounded-lg py-2 text-[11px] font-medium text-txt3 transition active:opacity-60"
          >
            <MessageSquarePlus className="h-6 w-6" />
            Report
          </button>
        </nav>
      </div>

      {/* ---------------- mobile Thoughts sheet ---------------- */}
      {thoughtsSheet && (
        <div className="fixed inset-0 z-50 lg:hidden" onClick={() => setThoughtsSheet(false)}>
          <div className="absolute inset-0 bg-black/50" />
          <div
            className="absolute inset-x-0 bottom-0 rounded-t-2xl border-t border-border bg-surface p-4 pb-8"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <span className="flex items-center gap-2 truncate text-sm text-txt3">
                <Brain className="h-4 w-4" /> Thoughts
              </span>
              <button onClick={() => setThoughtsSheet(false)} className="rounded p-1 text-txt3">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-1">
              {thoughtsChildren.map((c) => (
                <SheetRow
                  key={c.href}
                  icon={<c.icon className="h-[18px] w-[18px]" />}
                  label={c.label}
                  onClick={() => {
                    setThoughtsSheet(false);
                    router.push(c.href);
                  }}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ---------------- mobile overflow sheet ---------------- */}
      {sheet && (
        <div className="fixed inset-0 z-50 lg:hidden" onClick={() => setSheet(false)}>
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
              {isAdmin && (
                <SheetRow
                  icon={<Inbox className="h-[18px] w-[18px]" />}
                  label={`Feedback inbox${openCount ? ` (${openCount})` : ""}`}
                  onClick={() => {
                    setSheet(false);
                    router.push("/app/feedback");
                  }}
                />
              )}
              <SheetRow
                icon={<BookOpen className="h-[18px] w-[18px]" />}
                label="Notebooks"
                onClick={() => {
                  setSheet(false);
                  router.push("/app/notebooks");
                }}
              />
              <SheetRow
                icon={<Timer className="h-[18px] w-[18px]" />}
                label="Focus timer"
                onClick={() => {
                  setSheet(false);
                  router.push("/app/focus");
                }}
              />
              <SheetRow
                icon={<Zap className="h-[18px] w-[18px]" />}
                label="Automations"
                onClick={() => {
                  setSheet(false);
                  router.push("/app/automations");
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
      <FeedbackOverlay open={feedback} onClose={() => setFeedback(false)} />
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
