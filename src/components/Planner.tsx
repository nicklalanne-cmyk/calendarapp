"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { addDays, addMonths, format } from "date-fns";
import { ChevronLeft, ChevronRight, Link2, ListTodo, Loader2, CalendarPlus } from "lucide-react";
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
import {
  eventsCacheKey,
  getCachedEvents,
  isEventsCacheFresh,
  setCachedEvents,
  clearEventsCache,
} from "@/lib/eventsCache";
import EventModal, { type EventDraft } from "@/components/calendar/EventModal";
import TaskList from "@/components/tasks/TaskList";
import TaskModal, { type TaskDraft, type LinkedEvent } from "@/components/tasks/TaskModal";
import ScheduleSheet from "@/components/tasks/ScheduleSheet";
import { fireTaskCreated, fireTaskUpdated, fireTaskCompleted, fireEventCreated, fireEventUpdated } from "@/lib/automations";

type View = "day" | "week" | "month";

export default function Planner() {
  const supabase = createClient();
  const router = useRouter();
  const searchParams = useSearchParams();
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
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: u }) => setCurrentUserId(u.user?.id ?? null));
  }, [supabase]);

  // Deep-link support: other pages (e.g. Agenda's "jump to day" arrows) can
  // navigate here with ?date=YYYY-MM-DD&view=day to focus a specific day.
  useEffect(() => {
    const d = searchParams.get("date");
    const v = searchParams.get("view");
    if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) {
      setDate(new Date(`${d}T00:00:00`));
    }
    if (v === "day" || v === "week" || v === "month") {
      setView(v);
      setViewPinned(true);
    }
    if (d || v) router.replace("/app", { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const eventCols = (e: LinkedEvent) => ({
    linked_event_id: e?.id ?? null,
    linked_event_calendar_id: e?.calendarId ?? null,
    linked_event_account_id: e?.accountId || null,
    linked_event_title: e?.title ?? null,
    linked_event_start: e?.start || null,
  });

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

  // Stale-while-revalidate: cached ranges render instantly (no spinner, no
  // network wait) while a fresh copy is fetched silently in the background.
  // Only a genuinely uncached range shows the loading state and blocks.
  const loadEvents = useCallback(
    async (force = false) => {
      const seq = ++reqSeq.current;
      const range =
        view === "day" ? dayRange(date) : view === "week" ? weekRange(date) : monthRange(date);
      const timeMin = range.start.toISOString();
      const timeMax = range.end.toISOString();
      const key = eventsCacheKey(timeMin, timeMax);
      const cached = force ? undefined : getCachedEvents(key);

      if (cached) {
        setNoAccounts(cached.noAccounts);
        setEvents(cached.events);
        if (isEventsCacheFresh(cached)) return; // fresh enough, skip the network call entirely
      } else {
        setLoadingEvents(true);
      }

      const params = new URLSearchParams({ timeMin, timeMax });
      try {
        const res = await fetch(`/api/google/events?${params.toString()}`);
        const json = (await res.json()) as { events?: CalendarEvent[]; noAccounts?: boolean };
        if (seq !== reqSeq.current) return; // a newer request has since been issued
        const noAcc = Boolean(json.noAccounts);
        const evs = json.events ?? [];
        setCachedEvents(key, evs, noAcc);
        setNoAccounts(noAcc);
        setEvents(evs);
      } catch {
        if (seq !== reqSeq.current) return;
        if (!cached) {
          setEvents([]);
          toast("Couldn't load calendar", "error");
        }
      }
      if (seq === reqSeq.current) setLoadingEvents(false);
    },
    [view, date]
  );

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);
  useEffect(() => {
    loadEvents();
  }, [loadEvents]);
  // Background refresh every 10 minutes so data stays fresh without any
  // user-initiated navigation having to pay for it.
  useEffect(() => {
    const id = setInterval(() => loadEvents(true), 10 * 60 * 1000);
    return () => clearInterval(id);
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
      if (d?.events) {
        clearEventsCache();
        loadEvents(true);
      }
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

  // Time-blocked tasks are Cadence-native; render them on the grid alongside
  // Google events instead of writing them to Google.
  const taskBlocks = useMemo<CalendarEvent[]>(
    () =>
      tasks
        .filter((t) => t.scheduled_start && t.scheduled_end && !t.parent_id)
        .map((t) => ({
          id: `task:${t.id}`,
          title: t.title,
          start: t.scheduled_start!,
          end: t.scheduled_end!,
          allDay: false,
          color: "#7C6CF0",
          accountId: "",
          accountEmail: "",
          calendarId: "__tasks__",
          source: "task" as const,
          taskId: t.id,
          taskDone: t.is_done,
        })),
    [tasks]
  );

  const gridEvents = useMemo(
    () => [...visibleEvents, ...taskBlocks],
    [visibleEvents, taskBlocks]
  );

  /* ---------- tasks ---------- */
  const addTask = async (p: ParsedTask) => {
    const { data, error } = await supabase
      .from("tasks")
      .insert({
        title: p.title,
        due_date: p.due_date,
        due_kind: p.due_kind,
        priority: p.priority,
        rrule: p.rrule,
        project: p.project,
        tags: p.tags,
        estimate_minutes: p.estimate_minutes,
      })
      .select()
      .single();
    if (error) return toast(error.message, "error");
    if (data) await fireTaskCreated(supabase, data as Task);
    loadTasks();
  };

  const createTask = async (draftIn: TaskDraft) => {
    const { data, error } = await supabase
      .from("tasks")
      .insert({
        title: draftIn.title,
        due_date: draftIn.due_date,
        due_kind: draftIn.due_kind,
        priority: draftIn.priority,
        rrule: draftIn.rrule,
        project: draftIn.project,
        location: draftIn.location,
        tags: draftIn.tags,
        estimate_minutes: draftIn.estimate_minutes,
        notes: draftIn.notes,
        shared: draftIn.shared,
        ...eventCols(draftIn.linked_event),
      })
      .select()
      .single();
    if (error) return toast(error.message, "error");
    if (data) await fireTaskCreated(supabase, data as Task);
    setCreating(false);
    loadTasks();
  };

  const convertEventToTask = async (d: EventDraft) => {
    const { error } = await supabase.from("tasks").insert({
      title: d.title,
      due_date: d.start.toISOString().slice(0, 10),
      due_kind: "day",
      priority: 0,
      shared: false,
    });
    if (error) return toast(error.message, "error");
    toast(`Added task "${d.title}"`);
    setDraft(null);
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
    // Optimistic — a checkbox click should feel instant, not wait on a round
    // trip. loadTasks() below still reconciles with the server afterward.
    setTasks((cur) => cur.map((x) => (x.id === t.id ? { ...x, is_done: completing } : x)));
    const { error } = await supabase.from("tasks").update({ is_done: completing }).eq("id", t.id);
    if (error) {
      setTasks((cur) => cur.map((x) => (x.id === t.id ? { ...x, is_done: t.is_done } : x)));
      return toast(error.message, "error");
    }
    if (completing && (t.rrule || t.repeat) && !t.parent_id) {
      const due = nextDue(t, t.due_date);
      if (due) {
        await supabase.from("tasks").insert({
          title: t.title,
          priority: t.priority,
          project: t.project,
          location: t.location,
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
    if (completing) await fireTaskCompleted(supabase, t);
    loadTasks();
  };

  const deleteTask = async (t: Task) => {
    // Optimistic removal — don't make the user wait to see it disappear.
    setTasks((cur) => cur.filter((x) => x.id !== t.id));
    // Tasks are Cadence-native: nothing to remove from Google.
    const { error } = await supabase
      .from("tasks")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", t.id);
    if (error) {
      loadTasks();
      return toast(error.message, "error");
    }

    loadTasks();

    toast(`Deleted “${t.title}”`, {
      action: {
        label: "Undo",
        run: async () => {
          const { error: e } = await supabase
            .from("tasks")
            .update({ deleted_at: null })
            .eq("id", t.id);
          if (e) return toast(e.message, "error");
          toast("Restored");
          loadTasks();
        },
      },
    });
  };

  const addFollowUp = async (
    source: { title: string; project?: string | null },
    dueDate: string,
    dueKind: "day" | "week"
  ) => {
    const { error } = await supabase.from("tasks").insert({
      title: `Follow up: ${source.title}`,
      due_date: dueDate,
      due_kind: dueKind,
      priority: 0,
      project: source.project ?? null,
      shared: false,
    });
    if (error) return toast(error.message, "error");
    toast(`Follow-up added for ${dueDate}`);
    loadTasks();
  };

  const cyclePriority = async (t: Task) => {
    const next = (t.priority + 1) % 5;
    setTasks((cur) => cur.map((x) => (x.id === t.id ? { ...x, priority: next } : x)));
    const { error } = await supabase.from("tasks").update({ priority: next }).eq("id", t.id);
    if (error) {
      setTasks((cur) => cur.map((x) => (x.id === t.id ? { ...x, priority: t.priority } : x)));
      return toast(error.message, "error");
    }
    await fireTaskUpdated(supabase, { ...t, priority: next });
    loadTasks();
  };

  const updateTask = async (t: Task, draft: TaskDraft) => {
    const { scope, linked_event, ...rest } = draft;
    const patch = { ...rest, ...eventCols(linked_event) };

    if (scope === "occurrence" && (t.rrule || t.repeat)) {
      // Keep the series alive: spin the NEXT occurrence off as its own repeating task,
      // then let this row become a one-off carrying the user's edit.
      const due = nextDue(t, t.due_date);
      if (due) {
        const { error: sErr } = await supabase.from("tasks").insert({
          title: t.title,
          priority: t.priority,
          project: t.project,
          location: t.location,
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

    await fireTaskUpdated(supabase, {
      id: t.id,
      title: patch.title ?? t.title,
      project: patch.project ?? t.project,
      tags: patch.tags ?? t.tags,
      priority: patch.priority ?? t.priority,
      due_date: patch.due_date ?? t.due_date,
    });

    if (scope === "occurrence") toast("Updated this occurrence — the series continues");
    setEditing(null);
    loadTasks();
  };

  const scheduleTask = async (t: Task, start: Date, end: Date) => {
    // A time-block lives in Cadence. We no longer push it to Google Calendar.
    const { error } = await supabase
      .from("tasks")
      .update({
        scheduled_start: start.toISOString(),
        scheduled_end: end.toISOString(),
      })
      .eq("id", t.id);
    if (error) return toast(error.message, "error");

    setScheduling(null);
    toast(
      `Scheduled for ${start.toLocaleString(undefined, {
        weekday: "short",
        hour: "numeric",
        minute: "2-digit",
      })}`
    );
    loadTasks();
  };

  const unscheduleTask = async (t: Task) => {
    const { error } = await supabase
      .from("tasks")
      .update({ scheduled_start: null, scheduled_end: null })
      .eq("id", t.id);
    if (error) return toast(error.message, "error");
    loadTasks();
  };

  const moveScheduledTask = async (t: Task, start: Date, end: Date) => {
    setTasks((cur) =>
      cur.map((x) =>
        x.id === t.id
          ? { ...x, scheduled_start: start.toISOString(), scheduled_end: end.toISOString() }
          : x
      )
    );
    const { error } = await supabase
      .from("tasks")
      .update({ scheduled_start: start.toISOString(), scheduled_end: end.toISOString() })
      .eq("id", t.id);
    if (error) toast(error.message, "error");
  };

  const onGridClick = (ev: CalendarEvent) => {
    if (ev.source === "task") {
      const t = tasks.find((x) => x.id === ev.taskId);
      if (t) setEditing(t);
      return;
    }
    openEdit(ev);
  };

  const onGridMove = (ev: CalendarEvent, start: Date, end: Date) => {
    if (ev.source === "task") {
      const t = tasks.find((x) => x.id === ev.taskId);
      if (t) moveScheduledTask(t, start, end);
      return;
    }
    moveEvent(ev, start, end);
  };

  const onGridResize = (ev: CalendarEvent, end: Date) => {
    if (ev.source === "task") {
      const t = tasks.find((x) => x.id === ev.taskId);
      if (t && t.scheduled_start) moveScheduledTask(t, new Date(t.scheduled_start), end);
      return;
    }
    resizeEvent(ev, end);
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
      allDay: ev.allDay,
    });

  const saveEvent = async (d: EventDraft) => {
    const headers = { "Content-Type": "application/json" };
    // All-day events are sent as plain dates, not datetimes — using
    // toISOString() here would convert through UTC and could shift the date
    // by a day depending on the browser's timezone offset.
    const body = JSON.stringify({
      title: d.title,
      start: d.allDay ? format(d.start, "yyyy-MM-dd") : d.start.toISOString(),
      end: d.allDay ? format(d.end, "yyyy-MM-dd") : d.end.toISOString(),
      allDay: d.allDay ?? false,
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
    else if (!d.id) await fireEventCreated(supabase, d.title, d.start, d.location);
    else await fireEventUpdated(supabase, d.title, d.start, d.location);
    setDraft(null);
    clearEventsCache();
    loadEvents(true);
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
    clearEventsCache();
    loadEvents(true);
  };

  const patchEvent = async (ev: CalendarEvent, payload: Record<string, string>) => {
    const q = new URLSearchParams({ accountId: ev.accountId, calendarId: ev.calendarId });
    const res = await fetch(`/api/google/events/${ev.id}?${q.toString()}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) toast("Couldn't update the event", "error");
    clearEventsCache();
    loadEvents(true);
  };

  const moveEvent = (ev: CalendarEvent, start: Date, end: Date) =>
    patchEvent(ev, { start: start.toISOString(), end: end.toISOString() });
  const resizeEvent = (ev: CalendarEvent, end: Date) =>
    patchEvent(ev, { end: end.toISOString() });

  const dropTask = async (p: TaskDropPayload, start: Date, end: Date) => {
    // Drag-to-time-block. Cadence-native — no Google event is created.
    const { error } = await supabase
      .from("tasks")
      .update({
        scheduled_start: start.toISOString(),
        scheduled_end: end.toISOString(),
      })
      .eq("id", p.id);
    if (error) return toast(error.message, "error");
    toast(`Time-blocked “${p.title}”`);
    loadTasks();
  };

  const shift = useCallback(
    (dir: number) =>
      setDate((d) =>
        view === "day" ? addDays(d, dir) : view === "week" ? addDays(d, dir * 7) : addMonths(d, dir)
      ),
    [view]
  );

  // Builds a new event draft on the day currently being viewed (not always
  // "today") — previously this ignored `date` entirely, so navigating to a
  // future day and clicking "+ Event" silently created the event today.
  // Time-of-day still defaults sensibly: next hour if that viewed day is
  // actually today, otherwise a plain 9am so it isn't stamped with whatever
  // time you happen to be using the app.
  const newEventNow = useCallback(() => {
    const now = new Date();
    const s = new Date(date);
    const isToday = s.toDateString() === now.toDateString();
    if (isToday) {
      s.setHours(now.getHours() + 1, 0, 0, 0);
    } else {
      s.setHours(9, 0, 0, 0);
    }
    const e = new Date(s);
    e.setHours(e.getHours() + 1);
    setDraft({ title: "", start: s, end: e });
  }, [date]);

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
        {/* mobile: title gets its own row so it never truncates, controls sit below */}
        <header className="flex flex-col gap-1.5 border-b border-border px-2 py-1.5 md:hidden">
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setTasksOpen(true)}
              aria-label={`Open task list — ${openCount} open`}
              className="flex h-11 shrink-0 items-center gap-1 rounded-lg border border-border px-2.5 text-xs text-txt2 active:bg-surface2"
            >
              <ListTodo className="h-[18px] w-[18px]" />
              {openCount}
            </button>
            <h1 className="min-w-0 flex-1 truncate text-base font-semibold">{periodLabel}</h1>
            {loadingEvents && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-txt3" />}
            <button
              onClick={newEventNow}
              aria-label="Add event"
              className="flex h-11 shrink-0 items-center rounded-lg border border-border px-2.5 text-xs font-medium text-accent active:bg-surface2"
            >
              <CalendarPlus className="h-[18px] w-[18px]" />
            </button>
            <button
              onClick={() => setDate(new Date())}
              aria-label="Jump to today"
              className="flex h-11 shrink-0 items-center rounded-lg border border-border px-2.5 text-xs font-medium text-txt2 active:bg-surface2"
            >
              Today
            </button>
          </div>
          <div className="flex items-center gap-0.5">
            <button
              onClick={() => shift(-1)}
              aria-label="Previous"
              className="flex h-11 w-11 items-center justify-center rounded-lg text-txt2 active:bg-surface2"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button
              onClick={() => shift(1)}
              aria-label="Next"
              className="flex h-11 w-11 items-center justify-center rounded-lg text-txt2 active:bg-surface2"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
            <div className="ml-auto flex h-11 overflow-hidden rounded-lg border border-border text-[13px]">
              {(["day", "week", "month"] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => { setView(v); setViewPinned(true); }}
                  className={
                    v === view
                      ? "flex items-center px-4 text-white bg-accent"
                      : "flex items-center px-4 text-txt2 active:bg-surface2"
                  }
                >
                  {v[0].toUpperCase()}
                  <span className="hidden sm:inline">{v.slice(1)}</span>
                </button>
              ))}
            </div>
          </div>
        </header>

        {/* desktop: everything fits comfortably on one row */}
        <header className="hidden items-center gap-2 border-b border-border px-3 py-2 md:flex">
          <h1 className="truncate text-lg font-semibold">{periodLabel}</h1>
          {loadingEvents && <Loader2 className="h-3.5 w-3.5 animate-spin text-txt3" />}
          <button
            onClick={() => setDate(new Date())}
            aria-label="Jump to today"
            className="flex items-center rounded-md px-2 py-1 text-xs font-medium text-txt2 hover:bg-surface"
          >
            Today
          </button>
          <button
            onClick={newEventNow}
            className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium text-accent hover:bg-surface"
          >
            <CalendarPlus className="h-3.5 w-3.5" />
            Event
          </button>
          <div className="ml-auto flex items-center gap-1">
            <button
              onClick={() => shift(-1)}
              aria-label="Previous"
              className="flex items-center justify-center rounded-lg p-1 text-txt2 hover:bg-surface"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button
              onClick={() => shift(1)}
              aria-label="Next"
              className="flex items-center justify-center rounded-lg p-1 text-txt2 hover:bg-surface"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
            <div className="ml-1 flex overflow-hidden rounded-md border border-border text-xs">
              {(["day", "week", "month"] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => { setView(v); setViewPinned(true); }}
                  className={
                    v === view
                      ? "flex items-center px-3 py-1 text-white bg-accent"
                      : "flex items-center px-3 py-1 text-txt2 hover:bg-surface"
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
              events={gridEvents}
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
              events={gridEvents}
              onCreate={openCreate}
              onEventClick={onGridClick}
              onDropTask={dropTask}
              onMoveEvent={onGridMove}
              onResizeEvent={onGridResize}
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
          onConvertToTask={convertEventToTask}
          onAddFollowUp={(d, dueDate, dueKind) => addFollowUp({ title: d.title }, dueDate, dueKind)}
          onClose={() => setDraft(null)}
        />
      )}
      {editing && (
        <TaskModal
          task={editing}
          mode="edit"
          projects={projectNames}
          currentUserId={currentUserId}
          onSave={(patch) => updateTask(editing, patch)}
          onDelete={() => {
            deleteTask(editing);
            setEditing(null);
          }}
          onAddFollowUp={(dueDate, dueKind) =>
            addFollowUp({ title: editing.title, project: editing.project }, dueDate, dueKind)
          }
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
          currentUserId={currentUserId}
          onSave={createTask}
          onClose={() => setCreating(false)}
        />
      )}
    </div>
  );
}
