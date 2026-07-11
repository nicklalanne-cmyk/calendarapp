"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { addDays, addMonths, format } from "date-fns";
import { ChevronLeft, ChevronRight, Link2, ListTodo, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Task, CalendarEvent } from "@/lib/types";
import { dayRange, weekRange, monthRange, fmtDayHeader, fmtMonthYear } from "@/lib/dates";
import { nextDue, type ParsedTask } from "@/lib/tasks";
import { useSettings } from "@/components/SettingsProvider";
import { getHiddenCals } from "@/lib/calfilter";
import { toast } from "@/lib/toast";
import CalendarGrid, { type TaskDropPayload } from "@/components/calendar/CalendarGrid";
import MonthView from "@/components/calendar/MonthView";
import CalendarsPanel from "@/components/calendar/CalendarsPanel";
import EventModal, { type EventDraft } from "@/components/calendar/EventModal";
import TaskList from "@/components/tasks/TaskList";
import TaskModal, { type TaskDraft } from "@/components/tasks/TaskModal";
import ScheduleSheet from "@/components/tasks/ScheduleSheet";

type View = "day" | "week" | "month";

export default function Planner() {
  const supabase = createClient();
  const router = useRouter();
  const { settings, ready: settingsReady } = useSettings();
  const [view, setView] = useState<View>("day");
  const [viewPinned, setViewPinned] = useState(false);
  const [date, setDate] = useState<Date>(new Date());
  const [tasks, setTasks] = useState<Task[]>([]);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [draft, setDraft] = useState<EventDraft | null>(null);
  const [editing, setEditing] = useState<Task | null>(null);
  const [creating, setCreating] = useState(false);
  const [scheduling, setScheduling] = useState<Task | null>(null);
  const [noAccounts, setNoAccounts] = useState(false);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [loadingEvents, setLoadingEvents] = useState(true);
  const [tasksOpen, setTasksOpen] = useState(false);

  const loadTasks = useCallback(async () => {
    const { data, error } = await supabase
      .from("tasks")
      .select("*")
      .is("deleted_at", null)
      .order("created_at", { ascending: false });
    if (error) toast(error.message, "error");
    setTasks((data as Task[]) ?? []);
  }, [supabase]);

  // Guards against a slower, older request (e.g. the initial "day" fetch) resolving
  // after a newer one (the saved default "month" view) and clobbering its results.
  const reqSeq = useRef(0);

  const loadEvents = useCallback(async () => {
    const seq = ++reqSeq.current;
    setLoadingEvents(true);
    const range =
      view === "day" ? dayRange(date) : view === "week" ? weekRange(date) : monthRange(date);
    const params = new URLSearchParams({
      timeMin: range.start.toISOString(),
      timeMax: range.end.toISOString(),
    });
    try {
      const res = await fetch(`/api/google/events?${params.toString()}`);
      const json = (await res.json()) as { events?: CalendarEvent[]; noAccounts?: boolean };
      if (seq !== reqSeq.current) return; // a newer request has since been issued
      setNoAccounts(Boolean(json.noAccounts));
      setEvents(json.events ?? []);
    } catch {
      if (seq !== reqSeq.current) return;
      setEvents([]);
      toast("Couldn't load calendar", "error");
    }
    if (seq === reqSeq.current) setLoadingEvents(false);
  }, [view, date]);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);
  useEffect(() => {
    loadEvents();
  }, [loadEvents]);
  useEffect(() => {
    const h = () => loadTasks();
    window.addEventListener("cadence:tasks-changed", h);
    return () => window.removeEventListener("cadence:tasks-changed", h);
  }, [loadTasks]);
  useEffect(() => {
    const h = (e: Event) => {
      const d = (e as CustomEvent<{ tasks?: boolean; events?: boolean }>).detail;
      if (d?.tasks) loadTasks();
      if (d?.events) loadEvents();
    };
    window.addEventListener("cadence:ai-mutated", h as EventListener);
    return () => window.removeEventListener("cadence:ai-mutated", h as EventListener);
  }, [loadTasks, loadEvents]);

  useEffect(() => {
    const read = () => setHidden(getHiddenCals());
    read();
    window.addEventListener("cadence:cals-changed", read);
    return () => window.removeEventListener("cadence:cals-changed", read);
  }, []);
  useEffect(() => {
    const channel = supabase
      .channel("tasks-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks" }, () => loadTasks())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, loadTasks]);

  useEffect(() => {
    if (settingsReady && !viewPinned) setView(settings.default_view);
  }, [settingsReady, settings.default_view, viewPinned]);

  const projectNames = useMemo(
    () =>
      Array.from(new Set(tasks.map((t) => t.project).filter(Boolean) as string[])).sort(),
    [tasks]
  );

  const visibleEvents = useMemo(
    () => events.filter((e) => !hidden.has(e.calendarId)),
    [events, hidden]
  );

  /* ---------- tasks ---------- */
  const addTask = async (p: ParsedTask) => {
    const { error } = await supabase.from("tasks").insert({
      title: p.title,
      due_date: p.due_date,
      due_kind: p.due_kind,
      priority: p.priority,
      rrule: p.rrule,
      project: p.project,
      tags: p.tags,
      estimate_minutes: p.estimate_minutes,
    });
    if (error) return toast(error.message, "error");
    loadTasks();
  };

  const createTask = async (d: TaskDraft) => {
    const { error } = await supabase.from("tasks").insert({
      title: d.title,
      due_date: d.due_date,
      due_kind: d.due_kind,
      priority: d.priority,
      rrule: d.rrule,
      project: d.project,
      tags: d.tags,
      estimate_minutes: d.estimate_minutes,
      notes: d.notes,
    });
    if (error) return toast(error.message, "error");
    setCreating(false);
    loadTasks();
  };

  const addSubtask = async (parent: Task, title: string) => {
    const { error } = await supabase
      .from("tasks")
      .insert({ title, parent_id: parent.id, project: parent.project });
    if (error) return toast(error.message, "error");
    loadTasks();
  };

  const toggleTask = async (t: Task) => {
    const completing = !t.is_done;
    const { error } = await supabase.from("tasks").update({ is_done: completing }).eq("id", t.id);
    if (error) return toast(error.message, "error");
    if (completing && (t.rrule || t.repeat) && !t.parent_id) {
      const due = nextDue(t, t.due_date);
      if (due) {
        await supabase.from("tasks").insert({
          title: t.title,
          priority: t.priority,
          project: t.project,
          rrule: t.rrule ?? null,
          repeat: t.rrule ? null : t.repeat,
          tags: t.tags,
          estimate_minutes: t.estimate_minutes,
          notes: t.notes,
          due_kind: t.due_kind ?? "day",
          due_date: due,
        });
        toast("Repeating task rescheduled");
      }
    }
    loadTasks();
  };

  const deleteTask = async (t: Task) => {
    // Soft delete: the row sticks around so Undo is real, not a re-create with a new id.
    const { error } = await supabase
      .from("tasks")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", t.id);
    if (error) return toast(error.message, "error");

    // If we'd time-blocked it, pull the calendar event too — but remember enough to rebuild it.
    const block =
      t.google_event_id && t.google_account_id
        ? {
            id: t.google_event_id,
            accountId: t.google_account_id,
            calendarId: t.google_calendar_id ?? "primary",
            start: t.scheduled_start,
            end: t.scheduled_end,
            title: t.title,
          }
        : null;

    if (block) {
      const q = new URLSearchParams({
        accountId: block.accountId,
        calendarId: block.calendarId,
      });
      await fetch(`/api/google/events/${encodeURIComponent(block.id)}?${q}`, {
        method: "DELETE",
      });
    }

    loadTasks();
    loadEvents();

    toast(`Deleted “${t.title}”`, {
      action: {
        label: "Undo",
        run: async () => {
          const { error: unErr } = await supabase
            .from("tasks")
            .update({ deleted_at: null })
            .eq("id", t.id);
          if (unErr) return toast(unErr.message, "error");

          // put the time-block back if there was one
          if (block?.start && block?.end) {
            const res = await fetch("/api/google/events", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                title: block.title,
                start: block.start,
                end: block.end,
                accountId: block.accountId,
                calendarId: block.calendarId,
              }),
            });
            const j = await res.json().catch(() => ({}));
            if (j?.event?.id) {
              await supabase
                .from("tasks")
                .update({ google_event_id: j.event.id })
                .eq("id", t.id);
            }
          }
          toast("Restored");
          loadTasks();
          loadEvents();
        },
      },
    });
  };

  const cyclePriority = async (t: Task) => {
    const { error } = await supabase
      .from("tasks")
      .update({ priority: (t.priority + 1) % 5 })
      .eq("id", t.id);
    if (error) return toast(error.message, "error");
    loadTasks();
  };

  const updateTask = async (t: Task, draft: TaskDraft) => {
    const { scope, ...patch } = draft;

    if (scope === "occurrence" && (t.rrule || t.repeat)) {
      // Keep the series alive: spin the NEXT occurrence off as its own repeating task,
      // then let this row become a one-off carrying the user's edit.
      const due = nextDue(t, t.due_date);
      if (due) {
        const { error: sErr } = await supabase.from("tasks").insert({
          title: t.title,
          priority: t.priority,
          project: t.project,
          rrule: t.rrule ?? null,
          repeat: t.rrule ? null : t.repeat,
          tags: t.tags,
          estimate_minutes: t.estimate_minutes,
          notes: t.notes,
          due_kind: t.due_kind ?? "day",
          due_date: due,
        });
        if (sErr) return toast(sErr.message, "error");
      }
    }

    const { error } = await supabase
      .from("tasks")
      .update({ ...patch, repeat: patch.rrule ? null : null })
      .eq("id", t.id);
    if (error) return toast(error.message, "error");

    if (scope === "occurrence") toast("Updated this occurrence — the series continues");
    setEditing(null);
    loadTasks();
  };

  const scheduleTask = async (t: Task, start: Date, end: Date) => {
    const res = await fetch("/api/google/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: t.title,
        start: start.toISOString(),
        end: end.toISOString(),
      }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j?.event) {
      return toast(j?.error ?? "Couldn't add it to the calendar", "error");
    }
    const { error } = await supabase
      .from("tasks")
      .update({
        scheduled_start: start.toISOString(),
        scheduled_end: end.toISOString(),
        google_event_id: j.event.id,
        google_account_id: j.event.accountId,
        google_calendar_id: j.event.calendarId,
      })
      .eq("id", t.id);
    if (error) toast(error.message, "error");

    setScheduling(null);
    toast(
      `Scheduled for ${start.toLocaleString(undefined, {
        weekday: "short",
        hour: "numeric",
        minute: "2-digit",
      })}`
    );
    loadTasks();
    loadEvents();
  };

  const openNoteForTask = async (t: Task) => {
    const { data: existing } = await supabase.from("notes").select("id").eq("task_id", t.id).limit(1);
    let id: string | null = existing && existing.length ? (existing[0] as { id: string }).id : null;
    if (!id) {
      const { data, error } = await supabase
        .from("notes")
        .insert({ title: t.title, body: "", task_id: t.id })
        .select("id")
        .single();
      if (error) return toast(error.message, "error");
      id = data ? (data as { id: string }).id : null;
    }
    if (id) router.push(`/app/notes?note=${id}`);
  };

  /* ---------- events ---------- */
  const openCreate = (start: Date, end: Date) => setDraft({ title: "", start, end });
  const openEdit = (ev: CalendarEvent) =>
    setDraft({
      id: ev.id,
      title: ev.title,
      start: new Date(ev.start),
      end: new Date(ev.end),
      accountId: ev.accountId,
      calendarId: ev.calendarId,
      accountEmail: ev.accountEmail,
      location: ev.location ?? "",
      description: ev.description ?? "",
      attendees: ev.attendees,
      meetingLink: ev.meetingLink,
      recurring: ev.recurring,
    });

  const saveEvent = async (d: EventDraft) => {
    const headers = { "Content-Type": "application/json" };
    const body = JSON.stringify({
      title: d.title,
      start: d.start.toISOString(),
      end: d.end.toISOString(),
      location: d.location ?? null,
      description: d.description ?? null,
      recurrence: d.recurrence ?? null,
    });
    const res =
      d.id && d.accountId
        ? await fetch(
            `/api/google/events/${d.id}?${new URLSearchParams({
              accountId: d.accountId,
              calendarId: d.calendarId ?? "primary",
            }).toString()}`,
            { method: "PATCH", headers, body }
          )
        : await fetch(`/api/google/events`, { method: "POST", headers, body });
    if (!res.ok) toast("Couldn't save the event", "error");
    setDraft(null);
    loadEvents();
  };

  const deleteEvent = async (d: EventDraft) => {
    if (d.id && d.accountId) {
      const q = new URLSearchParams({
        accountId: d.accountId,
        calendarId: d.calendarId ?? "primary",
      });
      const res = await fetch(`/api/google/events/${d.id}?${q.toString()}`, { method: "DELETE" });
      if (!res.ok) toast("Couldn't delete the event", "error");
    }
    setDraft(null);
    loadEvents();
  };

  const patchEvent = async (ev: CalendarEvent, payload: Record<string, string>) => {
    const q = new URLSearchParams({ accountId: ev.accountId, calendarId: ev.calendarId });
    const res = await fetch(`/api/google/events/${ev.id}?${q.toString()}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) toast("Couldn't update the event", "error");
    loadEvents();
  };

  const moveEvent = (ev: CalendarEvent, start: Date, end: Date) =>
    patchEvent(ev, { start: start.toISOString(), end: end.toISOString() });
  const resizeEvent = (ev: CalendarEvent, end: Date) =>
    patchEvent(ev, { end: end.toISOString() });

  const dropTask = async (p: TaskDropPayload, start: Date, end: Date) => {
    const res = await fetch(`/api/google/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: p.title, start: start.toISOString(), end: end.toISOString() }),
    });
    if (!res.ok) {
      toast("Couldn't time-block that task", "error");
      return;
    }
    const j = (await res.json()) as {
      event?: { id: string; accountId: string; calendarId: string };
    };
    await supabase
      .from("tasks")
      .update({
        scheduled_start: start.toISOString(),
        scheduled_end: end.toISOString(),
        google_event_id: j.event?.id ?? null,
        google_account_id: j.event?.accountId ?? null,
        google_calendar_id: j.event?.calendarId ?? null,
      })
      .eq("id", p.id);
    toast("Task time-blocked");
    loadEvents();
    loadTasks();
  };

  /* ---------- navigation ---------- */
  const shift = useCallback(
    (dir: number) =>
      setDate((d) =>
        view === "day" ? addDays(d, dir) : view === "week" ? addDays(d, dir * 7) : addMonths(d, dir)
      ),
    [view]
  );

  const newEventNow = useCallback(() => {
    const s = new Date();
    s.setMinutes(0, 0, 0);
    s.setHours(s.getHours() + 1);
    const e = new Date(s);
    e.setHours(e.getHours() + 1);
    setDraft({ title: "", start: s, end: e });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      if (draft || editing) return;
      switch (e.key.toLowerCase()) {
        case "d": setView("day"); break;
        case "w": setView("week"); break;
        case "m": setView("month"); break;
        case "t": setDate(new Date()); break;
        case "c": newEventNow(); break;
        case "arrowleft": shift(-1); break;
        case "arrowright": shift(1); break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [draft, editing, shift, newEventNow]);

  // the mobile FAB asks us to open a create modal
  useEffect(() => {
    const t = () => setCreating(true);
    const e = () => newEventNow();
    window.addEventListener("cadence:new-task", t);
    window.addEventListener("cadence:new-event", e);
    return () => {
      window.removeEventListener("cadence:new-task", t);
      window.removeEventListener("cadence:new-event", e);
    };
  }, [newEventNow]);

  useEffect(() => {
    const goToday = () => setDate(new Date());
    const newEvt = () => newEventNow();
    const setV = (e: Event) => setView((e as CustomEvent).detail as View);
    window.addEventListener("cadence:go-today", goToday);
    window.addEventListener("cadence:new-event", newEvt);
    window.addEventListener("cadence:set-view", setV as EventListener);
    return () => {
      window.removeEventListener("cadence:go-today", goToday);
      window.removeEventListener("cadence:new-event", newEvt);
      window.removeEventListener("cadence:set-view", setV as EventListener);
    };
  }, [newEventNow]);

  const periodLabel =
    view === "day"
      ? fmtDayHeader(date)
      : view === "week"
        ? `Week of ${format(weekRange(date).start, "MMM d")}`
        : fmtMonthYear(date);

  const openCount = tasks.filter((t) => !t.is_done && !t.parent_id).length;

  const sidebar = (
    <>
      <div className="min-h-0 flex-1 overflow-hidden p-4 pb-2">
        <TaskList
          tasks={tasks}
          onAdd={addTask}
          onToggle={toggleTask}
          onDelete={deleteTask}
          onCyclePriority={cyclePriority}
          onAddSubtask={addSubtask}
          onOpenNote={openNoteForTask}
          onOpenTask={(t) => setEditing(t)}
          onNewTask={() => setCreating(true)}
          onSchedule={(t) => setScheduling(t)}
        />
      </div>
      <div className="px-4 pb-4">
        <CalendarsPanel />
      </div>
    </>
  );

  return (
    <div className="flex h-full">
      <aside className="hidden w-72 shrink-0 flex-col border-r border-border md:flex">{sidebar}</aside>

      {tasksOpen && (
        <div className="fixed inset-0 z-40 md:hidden" onClick={() => setTasksOpen(false)}>
          <div className="absolute inset-0 bg-black/50" />
          <aside
            className="absolute left-0 top-0 flex h-full w-80 max-w-[85%] flex-col border-r border-border bg-bg"
            onClick={(e) => e.stopPropagation()}
          >
            {sidebar}
          </aside>
        </div>
      )}

      <section className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex items-center gap-2 border-b border-border px-3 py-2">
          <button
            onClick={() => setTasksOpen(true)}
            className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-txt2 md:hidden"
          >
            <ListTodo className="h-[18px] w-[18px] md:h-4 md:w-4" />
            {openCount}
          </button>
          <h1 className="truncate text-base font-semibold md:text-lg">{periodLabel}</h1>
          {loadingEvents && <Loader2 className="h-3.5 w-3.5 animate-spin text-txt3" />}
          <button
            onClick={() => setDate(new Date())}
            className="hidden rounded-md border border-border px-2 py-1 text-xs text-txt2 hover:bg-surface sm:block"
          >
            Today
          </button>
          <div className="ml-auto flex items-center gap-1">
            <button
              onClick={() => shift(-1)}
              className="rounded-lg p-2 text-txt2 active:bg-surface2 md:p-1 md:hover:bg-surface"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button
              onClick={() => shift(1)}
              className="rounded-lg p-2 text-txt2 active:bg-surface2 md:p-1 md:hover:bg-surface"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
            <div className="ml-1 flex overflow-hidden rounded-md border border-border text-[13px] md:text-xs">
              {(["day", "week", "month"] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => { setView(v); setViewPinned(true); }}
                  className={
                    v === view
                      ? "bg-accent px-3 py-2 text-white md:py-1 sm:px-3"
                      : "px-3 py-2 text-txt2 hover:bg-surface md:py-1 sm:px-3"
                  }
                >
                  {v[0].toUpperCase()}
                  <span className="hidden sm:inline">{v.slice(1)}</span>
                </button>
              ))}
            </div>
          </div>
        </header>

        {noAccounts && (
          <div className="flex flex-wrap items-center gap-2 border-b border-border bg-surface px-4 py-2 text-xs text-txt2">
            <Link2 className="h-4 w-4 text-accent" />
            <span>No Google calendars connected yet.</span>
            <button
              onClick={() => (window.location.href = "/api/google/connect")}
              className="rounded-md bg-accent px-2 py-1 font-medium text-white"
            >
              Connect a Google account
            </button>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-hidden">
          {view === "month" ? (
            <MonthView
              date={date}
              events={visibleEvents}
              onPickDay={(d) => {
                setDate(d);
                setView("day");
              }}
              onEventClick={openEdit}
            />
          ) : (
            <CalendarGrid
              view={view === "week" ? "week" : "day"}
              date={date}
              events={visibleEvents}
              onCreate={openCreate}
              onEventClick={openEdit}
              onDropTask={dropTask}
              onMoveEvent={moveEvent}
              onResizeEvent={resizeEvent}
              onPickDay={(d) => {
                setDate(d);
                setView("day");
              }}
            />
          )}
        </div>
      </section>

      {draft && (
        <EventModal
          draft={draft}
          onSave={saveEvent}
          onDelete={draft.id ? () => deleteEvent(draft) : undefined}
          onClose={() => setDraft(null)}
        />
      )}
      {editing && (
        <TaskModal
          task={editing}
          mode="edit"
          projects={projectNames}
          onSave={(patch) => updateTask(editing, patch)}
          onDelete={() => {
            deleteTask(editing);
            setEditing(null);
          }}
          onClose={() => setEditing(null)}
        />
      )}
      {scheduling && (
        <ScheduleSheet
          task={scheduling}
          onClose={() => setScheduling(null)}
          onSchedule={(start, end) => scheduleTask(scheduling, start, end)}
        />
      )}
      {creating && (
        <TaskModal
          task={null}
          mode="create"
          projects={projectNames}
          onSave={createTask}
          onClose={() => setCreating(false)}
        />
      )}
    </div>
  );
}
