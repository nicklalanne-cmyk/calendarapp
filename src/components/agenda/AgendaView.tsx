"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { addDays, format, isSameDay, parseISO } from "date-fns";
import {
  Check, MapPin, Flag, Video, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight,
  ListTodo, X, Loader2, Users, Plus, ArrowUpRight, PanelRightClose, PanelRightOpen,
} from "lucide-react";
import clsx from "clsx";
import { createClient } from "@/lib/supabase/client";
import type { CalendarEvent, SharedEvent, Task } from "@/lib/types";
import { dayRange, fmtTime } from "@/lib/dates";
import { getHiddenCals } from "@/lib/calfilter";
import { toISODate } from "@/lib/recurrence";
import { startOfWeek } from "@/lib/tasks";
import { dueChip } from "@/components/tasks/TaskItem";
import { toast } from "@/lib/toast";
import {
  clearEventsCache, eventsCacheKey, getCachedEvents, isEventsCacheFresh, setCachedEvents,
} from "@/lib/eventsCache";
import EventModal, { type EventDraft } from "@/components/calendar/EventModal";
import TaskModal, { type TaskDraft } from "@/components/tasks/TaskModal";
import { runTaskCompletedAutomations, runEventCreatedAutomations, applyConditionalAutomations } from "@/lib/automations";
import { useSettings } from "@/components/SettingsProvider";

const PRIORITY_COLOR = ["", "#F06C7C", "#F0A24F", "#56A8F0", "#9A8CF5"];

export default function AgendaView() {
  const supabase = createClient();
  const [anchor, setAnchor] = useState(new Date());
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<EventDraft | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  // Events the partner shared with you — a denormalised snapshot, not fetched
  // from Google. This view-only feed is scoped to AgendaView; Planner's
  // Google-Calendar-grid rendering (CalendarGrid/MonthView) doesn't consume it —
  // wiring it into that grid is a bigger visual job, out of scope for this pass.
  const [sharedEvents, setSharedEvents] = useState<SharedEvent[]>([]);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [tasksOpen, setTasksOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [mode, setMode] = useState<"day" | "week">("day");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const touchX = useRef<number | null>(null);
  const { settings } = useSettings();
  const appliedDefaultMode = useRef(false);

  // apply the user's preferred default Agenda view once settings load,
  // without stomping on a mode switch they've already made this session
  useEffect(() => {
    if (appliedDefaultMode.current) return;
    if (settings.agenda_view === "day" || settings.agenda_view === "week") {
      setMode(settings.agenda_view);
      appliedDefaultMode.current = true;
    }
  }, [settings.agenda_view]);

  const strip = useMemo(() => {
    const s0 = startOfWeek(anchor);
    return Array.from({ length: 7 }, (_, i) => addDays(s0, i));
  }, [anchor]);

  // Week mode is a plain Sunday-start list of that week's tasks, day by
  // day — not a calendar grid. Day mode still shows the day's events too.
  const days = useMemo(() => (mode === "week" ? strip : [anchor]), [mode, anchor, strip]);

  const reqSeq = useRef(0);

  // Shares the same cache as Planner, keyed by time range — so switching
  // between Agenda and Planner on the same day doesn't re-fetch from Google.
  const load = useCallback(
    async (force = false) => {
      if (days.length === 0) return;
      const seq = ++reqSeq.current;
      const start = dayRange(days[0]).start;
      const end = dayRange(days[days.length - 1]).end;
      const timeMin = start.toISOString();
      const timeMax = end.toISOString();
      const key = eventsCacheKey(timeMin, timeMax);
      const cached = force ? undefined : getCachedEvents(key);

      if (cached) {
        setEvents(cached.events);
      } else {
        setLoading(true);
      }

      if (!cached || !isEventsCacheFresh(cached)) {
        const params = new URLSearchParams({ timeMin, timeMax });
        try {
          const res = await fetch(`/api/google/events?${params.toString()}`);
          const j = (await res.json()) as { events?: CalendarEvent[]; noAccounts?: boolean };
          if (seq !== reqSeq.current) return;
          const evs = j.events ?? [];
          setCachedEvents(key, evs, Boolean(j.noAccounts));
          setEvents(evs);
        } catch {
          if (seq !== reqSeq.current) return;
          if (!cached) setEvents([]);
        }
      }
      const { data } = await supabase
        .from("tasks")
        .select("*")
        .eq("is_done", false)
        .is("deleted_at", null);
      if (seq !== reqSeq.current) return;
      setTasks((data as Task[]) ?? []);

      // RLS only returns rows the partner shared with you — none of your own,
      // since your own real events already arrive via the Google fetch above.
      const { data: shared } = await supabase
        .from("shared_events")
        .select("*")
        .gte("start_at", start.toISOString())
        .lte("start_at", end.toISOString());
      if (seq !== reqSeq.current) return;
      setSharedEvents((shared as SharedEvent[]) ?? []);
      setLoading(false);
    },
    [supabase, days]
  );

  useEffect(() => {
    setHidden(getHiddenCals());
    const h = () => setHidden(getHiddenCals());
    window.addEventListener("cadence:cals-changed", h);
    return () => window.removeEventListener("cadence:cals-changed", h);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Background refresh every 10 minutes so data stays fresh without any
  // user-initiated navigation having to pay for it.
  useEffect(() => {
    const id = setInterval(() => load(true), 10 * 60 * 1000);
    return () => clearInterval(id);
  }, [load]);

  useEffect(() => {
    const h = () => load(true);
    window.addEventListener("cadence:ai-mutated", h);
    window.addEventListener("cadence:tasks-changed", h);
    return () => {
      window.removeEventListener("cadence:ai-mutated", h);
      window.removeEventListener("cadence:tasks-changed", h);
    };
  }, [load]);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: u }) => setCurrentUserId(u.user?.id ?? null));
  }, [supabase]);

  const projectNames = useMemo(
    () => Array.from(new Set(tasks.map((t) => t.project).filter(Boolean))) as string[],
    [tasks]
  );

  const createTask = async (draftIn: TaskDraft) => {
    const d = await applyConditionalAutomations(supabase, draftIn);
    const { error } = await supabase.from("tasks").insert({
      title: d.title,
      due_date: d.due_date,
      due_kind: d.due_kind,
      priority: d.priority,
      rrule: d.rrule,
      project: d.project,
      location: d.location,
      tags: d.tags,
      estimate_minutes: d.estimate_minutes,
      notes: d.notes,
      shared: d.shared,
      linked_event_id: d.linked_event?.id ?? null,
      linked_event_calendar_id: d.linked_event?.calendarId ?? null,
      linked_event_account_id: d.linked_event?.accountId || null,
      linked_event_title: d.linked_event?.title ?? null,
      linked_event_start: d.linked_event?.start || null,
    });
    if (error) return toast(error.message, "error");
    setCreating(false);
    load(true);
  };

  const updateTask = async (t: Task, d: TaskDraft) => {
    const patch = await applyConditionalAutomations(supabase, {
      title: d.title,
      due_date: d.due_date,
      due_kind: d.due_kind,
      priority: d.priority,
      rrule: d.rrule,
      project: d.project,
      location: d.location,
      tags: d.tags,
      estimate_minutes: d.estimate_minutes,
      notes: d.notes,
      shared: d.shared,
      linked_event_id: d.linked_event?.id ?? null,
      linked_event_calendar_id: d.linked_event?.calendarId ?? null,
      linked_event_account_id: d.linked_event?.accountId || null,
      linked_event_title: d.linked_event?.title ?? null,
      linked_event_start: d.linked_event?.start || null,
    });
    const { error } = await supabase.from("tasks").update(patch).eq("id", t.id);
    if (error) return toast(error.message, "error");
    setEditingTask(null);
    load(true);
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
    load(true);
  };

  const deleteTask = async (t: Task) => {
    setTasks((cur) => cur.filter((x) => x.id !== t.id));
    const { error } = await supabase
      .from("tasks")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", t.id);
    if (error) {
      load(true);
      return toast(error.message, "error");
    }
    toast(`Deleted "${t.title}"`);
    load(true);
  };

  const openEvent = (ev: CalendarEvent) =>
    setDraft({
      id: ev.id,
      title: ev.title,
      start: parseISO(ev.start),
      end: parseISO(ev.end),
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
    else if (!d.id) await runEventCreatedAutomations(supabase, d.title, d.start);
    setDraft(null);
    clearEventsCache();
    load(true);
  };

  const deleteEvent = async (d: EventDraft) => {
    if (d.id && d.accountId) {
      const q = new URLSearchParams({ accountId: d.accountId, calendarId: d.calendarId ?? "primary" });
      const res = await fetch(`/api/google/events/${d.id}?${q.toString()}`, { method: "DELETE" });
      if (!res.ok) toast("Couldn't delete the event", "error");
    }
    setDraft(null);
    clearEventsCache();
    load(true);
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
    load(true);
  };

  const jumpToDay = (day: Date) => {
    setAnchor(day);
    setMode("day");
  };

  const onDropOnDay = async (e: React.DragEvent, day: Date) => {
    e.preventDefault();
    const raw = e.dataTransfer.getData("application/json");
    if (!raw) return;
    let data: { kind: "task" | "event"; id: string; calendarId?: string; accountId?: string };
    try {
      data = JSON.parse(raw);
    } catch {
      return;
    }
    const dayStr = format(day, "yyyy-MM-dd");
    if (data.kind === "task") {
      const { error } = await supabase.from("tasks").update({ due_date: dayStr }).eq("id", data.id);
      if (error) return toast(error.message, "error");
      load(true);
      return;
    }
    const ev = events.find((x) => x.id === data.id && x.calendarId === data.calendarId);
    if (!ev || !ev.accountId) return;
    const oldStart = parseISO(ev.start);
    const oldEnd = parseISO(ev.end);
    const durMs = oldEnd.getTime() - oldStart.getTime();
    const newStart = new Date(day);
    newStart.setHours(oldStart.getHours(), oldStart.getMinutes(), 0, 0);
    const newEnd = new Date(newStart.getTime() + durMs);
    const q = new URLSearchParams({ accountId: ev.accountId, calendarId: ev.calendarId });
    const res = await fetch(`/api/google/events/${ev.id}?${q.toString()}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ start: newStart.toISOString(), end: newEnd.toISOString() }),
    });
    if (!res.ok) return toast("Couldn't move the event", "error");
    clearEventsCache();
    load(true);
  };

  const completeTask = async (t: Task) => {
    // Optimistic — checking a task off shouldn't wait on a round trip.
    setTasks((cur) => cur.map((x) => (x.id === t.id ? { ...x, is_done: true } : x)));
    const { error } = await supabase.from("tasks").update({ is_done: true }).eq("id", t.id);
    if (error) {
      setTasks((cur) => cur.map((x) => (x.id === t.id ? { ...x, is_done: false } : x)));
      return toast(error.message, "error");
    }
    await runTaskCompletedAutomations(supabase, t.title);
    load();
  };

  const shift = (dir: 1 | -1) => setAnchor((d) => addDays(d, dir));
  const shiftWeek = (dir: 1 | -1) => setAnchor((d) => addDays(d, dir * 7));

  const visibleEvents = events.filter((e) => !hidden.has(e.calendarId));
  const todayStr = format(new Date(), "yyyy-MM-dd");
  const thisWeekEndStr = toISODate(addDays(startOfWeek(new Date()), 6));

  const title =
    mode === "week"
      ? `${format(strip[0], "MMM d")} – ${format(strip[6], "MMM d")}`
      : format(anchor, "EEEE, MMM d");

  // Manual drag-to-reorder position. Tasks without one yet fall back to a key
  // derived from priority (major) then created_at (minor) — i.e. today's default
  // sort order — so untouched tasks keep behaving exactly as before until the
  // user actually drags something.
  const taskOrderKey = (t: Task) =>
    t.sort_order ?? (t.priority || 99) * 1e13 + new Date(t.created_at).getTime();
  const taskOrderCmp = (a: Task, b: Task) => taskOrderKey(a) - taskOrderKey(b);
  // Chronological first (earliest due date first), falling back to the manual/
  // priority order above for same-day ties — this is what actually makes the
  // sidebar buckets read top-to-bottom in date order instead of looking shuffled.
  const chronoCmp = (a: Task, b: Task) => {
    const ad = a.due_date ?? "";
    const bd = b.due_date ?? "";
    return ad !== bd ? ad.localeCompare(bd) : taskOrderCmp(a, b);
  };

  // !t.is_done here (not just the server-side query) so completing a task
  // optimistically removes it from view immediately, before the reload lands.
  // Subtasks (parent_id set) used to be filtered out entirely here — Agenda
  // has no nested-list layout the way Planner's TaskList does, so they just
  // vanished instead of showing anywhere. They're included now, tagged with
  // a small "↳ parent title" hint in TaskRow so it's still clear they belong
  // to something.
  const openTasks = tasks.filter((t) => !t.is_done);
  const taskById = new Map(tasks.map((x) => [x.id, x]));
  // These buckets are anchored to the real, current-moment "today" — not to
  // whichever day/week the main view happens to be showing — so "Due today"
  // never mislabels a future day's tasks just because you navigated forward.
  const overdue = openTasks
    .filter((t) => t.due_date && t.due_date < todayStr)
    .sort(chronoCmp);
  const dueToday = openTasks.filter((t) => t.due_date === todayStr).sort(taskOrderCmp);
  const dueThisWeek = openTasks
    .filter((t) => t.due_date && t.due_date > todayStr && t.due_date <= thisWeekEndStr)
    .sort(chronoCmp);
  const later = openTasks
    .filter((t) => t.due_date && t.due_date > thisWeekEndStr)
    .sort(chronoCmp);
  // Week-kind tasks for the week currently on screen — shown once, as a
  // banner across the whole week, rather than repeated in every day column.
  const weekLongTasks =
    mode === "week"
      ? openTasks
          .filter((t) => (t.due_kind ?? "day") === "week" && t.due_date === toISODate(strip[0]))
          .sort(taskOrderCmp)
      : [];
  const unscheduled = openTasks
    .filter((t) => !t.due_date)
    .sort(taskOrderCmp);

  // Drag a task onto another task row to reorder it — picks a sort_order value
  // that sits between the two rows it lands between (in the *effective* order,
  // i.e. taskOrderKey, not raw array index) so untouched siblings don't need to
  // be renumbered. When dueSync is set (day columns in week view), dropping a
  // task onto a row that lives on a different day also moves it to that day —
  // a natural combination of "reorder" and the existing drag-to-move behavior.
  const reorderTask = async (
    list: Task[],
    draggedId: string,
    targetTask: Task,
    position: "before" | "after",
    dueSync?: boolean
  ) => {
    if (draggedId === targetTask.id) return;
    const ordered = [...list].sort(taskOrderCmp);
    const withoutDragged = ordered.filter((x) => x.id !== draggedId);
    const targetIdx = withoutDragged.findIndex((x) => x.id === targetTask.id);
    if (targetIdx === -1) return;
    const insertAt = position === "before" ? targetIdx : targetIdx + 1;
    const prev = withoutDragged[insertAt - 1];
    const next = withoutDragged[insertAt];
    const prevKey = prev ? taskOrderKey(prev) : next ? taskOrderKey(next) - 2 : 0;
    const nextKey = next ? taskOrderKey(next) : prevKey + 2;
    const newOrder = (prevKey + nextKey) / 2;

    const patch: { sort_order: number; due_date?: string | null; due_kind?: "day" | "week" } = {
      sort_order: newOrder,
    };
    if (dueSync) {
      const dragged = tasks.find((x) => x.id === draggedId);
      if (
        dragged &&
        ((dragged.due_date ?? null) !== (targetTask.due_date ?? null) ||
          (dragged.due_kind ?? "day") !== (targetTask.due_kind ?? "day"))
      ) {
        patch.due_date = targetTask.due_date;
        patch.due_kind = targetTask.due_kind ?? "day";
      }
    }

    setTasks((cur) => cur.map((x) => (x.id === draggedId ? { ...x, ...patch } : x)));
    const { error } = await supabase.from("tasks").update(patch).eq("id", draggedId);
    if (error) {
      toast(error.message, "error");
      load(true);
    }
  };

  const TaskRow = ({
    t,
    showDue,
    draggable = true,
    list,
    dueSync,
    compact,
  }: {
    t: Task;
    showDue?: boolean;
    draggable?: boolean;
    /** The (unsorted) set of tasks t belongs to — passing this makes the row a
     * drop target for drag-to-reorder within that set. */
    list?: Task[];
    dueSync?: boolean;
    /** Smaller text/spacing — used by the desktop week grid so all 7 day
     * columns fit on screen at once instead of scrolling. */
    compact?: boolean;
  }) => {
    const chip = t.due_date ? dueChip(t.due_date, t.due_kind ?? "day") : null;
    const parent = t.parent_id ? taskById.get(t.parent_id) : undefined;
    const [dragPos, setDragPos] = useState<"before" | "after" | null>(null);
    return (
      <div
        draggable={draggable}
        onDragStart={
          draggable
            ? (e) => {
                e.dataTransfer.setData("application/json", JSON.stringify({ kind: "task", id: t.id }));
                e.dataTransfer.effectAllowed = "move";
              }
            : undefined
        }
        onDragOver={
          list
            ? (e) => {
                e.preventDefault();
                e.stopPropagation();
                const rect = e.currentTarget.getBoundingClientRect();
                setDragPos(e.clientY - rect.top < rect.height / 2 ? "before" : "after");
              }
            : undefined
        }
        onDragLeave={list ? () => setDragPos(null) : undefined}
        onDrop={
          list
            ? (e) => {
                e.preventDefault();
                e.stopPropagation();
                const pos = dragPos;
                setDragPos(null);
                const raw = e.dataTransfer.getData("application/json");
                if (!raw) return;
                try {
                  const data = JSON.parse(raw);
                  if (data.kind === "task" && data.id) reorderTask(list, data.id, t, pos ?? "after", dueSync);
                } catch {
                  /* ignore */
                }
              }
            : undefined
        }
        onClick={() => setEditingTask(t)}
        className={clsx(
          "group flex cursor-pointer items-center rounded-lg hover:bg-surface2",
          compact ? "gap-1 px-1.5 py-1" : "gap-2.5 px-2 py-2.5 md:py-1.5",
          draggable && "cursor-grab active:cursor-grabbing",
          dragPos === "before" && "border-t-2 border-accent",
          dragPos === "after" && "border-b-2 border-accent"
        )}
      >
        <button
          onClick={(e) => {
            e.stopPropagation();
            completeTask(t);
          }}
          aria-label={`Mark "${t.title}" done`}
          className={clsx(
            "shrink-0 items-center justify-center rounded-full border-2 border-txt3 transition active:bg-accent active:text-white md:border md:hover:border-accent md:hover:bg-accent md:hover:text-white",
            compact
              ? "hidden md:flex md:h-3 md:w-3 md:p-0"
              : "-m-1.5 flex h-9 w-9 p-1.5 md:m-0 md:h-[18px] md:w-[18px] md:p-0"
          )}
        >
          <Check
            className={clsx(
              "opacity-40 active:opacity-100 md:opacity-0 md:group-hover:opacity-100",
              compact ? "h-2 w-2" : "h-4 w-4 md:h-2.5 md:w-2.5"
            )}
          />
        </button>
        {t.priority > 0 && (
          <Flag
            className={clsx("shrink-0", compact ? "h-2.5 w-2.5" : "h-3 w-3")}
            style={{ color: PRIORITY_COLOR[t.priority], fill: PRIORITY_COLOR[t.priority] }}
          />
        )}
        {parent && (
          <span
            title={`Subtask of "${parent.title}"`}
            className={clsx("shrink-0 text-txt3", compact ? "text-[9px]" : "text-[11px] md:text-[10px]")}
          >
            ↳
          </span>
        )}
        <span
          className={clsx(
            "min-w-0 flex-1 text-txt",
            compact ? "text-[10px] leading-tight" : "text-[15px] md:text-xs",
            mode === "week" ? "break-words" : "truncate"
          )}
        >
          {t.title}
        </span>
        {t.location && (
          <span title={t.location} className="shrink-0">
            <MapPin className={clsx("text-txt3", compact ? "h-2.5 w-2.5" : "h-3 w-3")} />
          </span>
        )}
        {showDue && chip && (
          <span
            className={clsx(
              "shrink-0 whitespace-nowrap text-[11px] md:text-[10px]",
              chip.overdue ? "text-danger" : "text-txt3"
            )}
          >
            {chip.label}
          </span>
        )}
      </div>
    );
  };

  // `horizontal` is true only for the desktop week-view column layout — there,
  // titles wrap instead of truncating since each column has room to grow
  // vertically. The mobile week list and day view stay truncated/vertical.
  const renderDayCell = (day: Date, horizontal: boolean) => {
    const dayStr = format(day, "yyyy-MM-dd");
    const isToday = dayStr === todayStr;
    const dayEvents = visibleEvents
      .filter((e) => isSameDay(parseISO(e.start), day))
      .sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start.localeCompare(b.start));
    // Week-kind tasks aren't tied to one day — in week mode they show once, in
    // a "This week" banner above the grid, instead of repeating in every
    // column. In day mode there's only one day on screen, so it's shown right
    // there whenever the viewed day falls anywhere in that task's week.
    const dayWeekStart = format(startOfWeek(day), "yyyy-MM-dd");
    const dayTasks = openTasks
      .filter((t) =>
        (t.due_kind ?? "day") === "week"
          ? mode === "day" && t.due_date === dayWeekStart
          : t.due_date === dayStr
      )
      .sort(taskOrderCmp);
    const daySharedEvents =
      mode === "day"
        ? sharedEvents
            .filter((e) => isSameDay(parseISO(e.start_at), day))
            .sort((a, b) => a.start_at.localeCompare(b.start_at))
        : [];

    const emptyDay = dayEvents.length === 0 && dayTasks.length === 0 && daySharedEvents.length === 0;
    const titleCls = horizontal ? "break-words" : "truncate";

    return (
      <div
        key={dayStr}
        className={horizontal ? "flex min-w-0 flex-col" : "mb-5"}
        onDragOver={mode === "week" ? (e) => e.preventDefault() : undefined}
        onDrop={mode === "week" ? (e) => onDropOnDay(e, day) : undefined}
      >
        <div
          className={clsx(
            "mb-2 flex flex-nowrap items-baseline overflow-hidden border-b border-border pb-1",
            horizontal ? "gap-1" : "gap-2"
          )}
        >
          <span
            className={clsx(
              "shrink-0 whitespace-nowrap font-semibold",
              horizontal ? "text-xs" : "text-sm md:text-xs",
              isToday ? "text-accent" : "text-txt"
            )}
          >
            {isToday ? "Today" : horizontal ? format(day, "EEE") : format(day, "EEEE")}
          </span>
          <span
            className={clsx(
              "shrink-0 whitespace-nowrap text-txt3",
              horizontal ? "text-[10px]" : "text-xs md:text-[10px]"
            )}
          >
            {format(day, "MMM d")}
          </span>
          {emptyDay && mode === "day" && (
            <span className="ml-auto text-xs text-txt3 md:text-[10px]">Nothing scheduled</span>
          )}
          {mode === "week" && (
            <button
              onClick={() => jumpToDay(day)}
              title="Open this day to edit, add, or delete"
              className={clsx(
                "ml-auto flex shrink-0 items-center gap-1 rounded-md text-txt3 hover:bg-surface2 hover:text-accent",
                horizontal ? "p-0.5" : "px-1.5 py-0.5 text-[11px] md:text-[10px]"
              )}
            >
              {!horizontal && "Open day "}
              <ArrowUpRight className="h-3 w-3 shrink-0" />
            </button>
          )}
        </div>

        {emptyDay && horizontal && <div className="py-2 text-xs text-txt3">Nothing scheduled</div>}

        <div className="divide-y divide-txt3/10">
        {dayTasks.map((t) => (
          <TaskRow
            key={t.id}
            t={t}
            showDue={(t.due_kind ?? "day") === "week"}
            list={dayTasks}
            dueSync={mode === "week"}
            compact={horizontal}
          />
        ))}

        {dayEvents.map((e) => (
          <div
            key={`${e.calendarId}:${e.id}`}
            onClick={() => openEvent(e)}
            draggable={mode === "week"}
            onDragStart={
              mode === "week"
                ? (ev) =>
                    ev.dataTransfer.setData(
                      "application/json",
                      JSON.stringify({ kind: "event", id: e.id, calendarId: e.calendarId })
                    )
                : undefined
            }
            className={clsx(
              "flex cursor-pointer flex-col rounded-lg hover:bg-surface2",
              horizontal ? "gap-0.5 px-1.5 py-1" : "gap-0.5 px-2 py-2.5 md:py-1.5",
              mode === "week" && "cursor-grab active:cursor-grabbing"
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex min-w-0 items-start gap-2">
                <span
                  className={clsx(
                    "shrink-0 rounded-full",
                    horizontal ? "mt-1 h-1.5 w-1.5" : "mt-1.5 h-2 w-2"
                  )}
                  style={{ background: e.color ?? "#56A8F0" }}
                />
                <span
                  className={clsx(
                    "text-txt",
                    horizontal ? "text-[10px] leading-tight" : "text-[15px] md:text-xs",
                    titleCls
                  )}
                >
                  {e.title}
                </span>
              </div>
              <span
                className={clsx(
                  "shrink-0 whitespace-nowrap tabular-nums text-txt3",
                  horizontal ? "text-[10px]" : "text-xs md:text-[10px]"
                )}
              >
                {e.allDay ? "All day" : fmtTime(parseISO(e.start))}
              </span>
            </div>
            <div
              className={clsx(
                "flex items-center gap-3 text-txt3",
                horizontal ? "pl-3 text-[10px]" : "pl-4 text-[11px] md:text-[10px]"
              )}
            >
              {e.location && mode === "week" && (
                <span title={e.location} className="shrink-0">
                  <MapPin className="h-3 w-3" />
                </span>
              )}
              {e.location && mode !== "week" && (
                <span className="flex min-w-0 items-center gap-1">
                  <MapPin className="h-3 w-3 shrink-0" />
                  <span className={titleCls}>{e.location}</span>
                </span>
              )}
              {e.meetingLink && (
                <a
                  href={e.meetingLink}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(ev) => ev.stopPropagation()}
                  className="flex shrink-0 items-center gap-1 text-accentSoft hover:underline"
                >
                  <Video className="h-3 w-3" /> {!horizontal && "Join"}
                </a>
              )}
            </div>
          </div>
        ))}

        {daySharedEvents.map((e) => (
          <div
            key={`shared:${e.id}`}
            className="flex flex-col gap-0.5 rounded-lg px-2 py-2.5 hover:bg-surface2 md:py-1.5"
            title="Shared with you by your partner"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex min-w-0 items-start gap-2">
                <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accentSoft" />
                <span className={clsx("flex items-center gap-1.5 text-[15px] text-txt md:text-xs", titleCls)}>
                  <span className={titleCls}>{e.title}</span>
                  <Users className="h-3 w-3 shrink-0 text-accentSoft" />
                </span>
              </div>
              <span className="shrink-0 whitespace-nowrap text-xs tabular-nums text-txt3 md:text-[10px]">
                {e.all_day ? "All day" : fmtTime(parseISO(e.start_at))}
              </span>
            </div>
            <div className="pl-4">
              {e.location && (
                <div className="flex items-center gap-1 text-[11px] text-txt3 md:text-[10px]">
                  <MapPin className="h-3 w-3 shrink-0" />
                  <span className={titleCls}>{e.location}</span>
                </div>
              )}
            </div>
          </div>
        ))}
        </div>
      </div>
    );
  };

  const taskPanel = (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      <div className="flex items-center justify-between">
        <p className="text-[11px] uppercase tracking-wide text-txt3">Your open tasks</p>
        <button
          onClick={() => setSidebarOpen(false)}
          title="Collapse"
          className="hidden rounded p-1 text-txt3 hover:bg-surface2 hover:text-txt lg:block"
        >
          <PanelRightClose className="h-3.5 w-3.5" />
        </button>
      </div>
      <Bucket title="Overdue" count={overdue.length} danger>
        {overdue.map((t) => (
          <TaskRow key={t.id} t={t} showDue list={overdue} />
        ))}
      </Bucket>
      <Bucket title="Due today" count={dueToday.length}>
        {dueToday.map((t) => (
          <TaskRow key={t.id} t={t} list={dueToday} />
        ))}
      </Bucket>
      <Bucket title="Due this week" count={dueThisWeek.length}>
        {dueThisWeek.map((t) => (
          <TaskRow key={t.id} t={t} showDue list={dueThisWeek} />
        ))}
      </Bucket>
      <Bucket title="Later" count={later.length}>
        {later.map((t) => (
          <TaskRow key={t.id} t={t} showDue list={later} />
        ))}
      </Bucket>
      <Bucket title="Unscheduled" count={unscheduled.length}>
        {unscheduled.map((t) => (
          <TaskRow key={t.id} t={t} list={unscheduled} />
        ))}
      </Bucket>
      {overdue.length === 0 &&
        dueToday.length === 0 &&
        dueThisWeek.length === 0 &&
        later.length === 0 &&
        unscheduled.length === 0 && (
          <div className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-txt3">
            No open tasks right now. New tasks (overdue, upcoming, or with no due date) show up here.
          </div>
        )}
    </div>
  );

  return (
    <div className="flex h-full min-w-0">
      <div className="flex min-w-0 flex-1 flex-col">
        {/* desktop header */}
        <header className="hidden items-center gap-2 border-b border-border px-4 py-2.5 md:flex">
          <h1 className="text-sm font-semibold">{title}</h1>
          <div className="ml-1 flex items-center">
            <button
              onClick={() => shiftWeek(-1)}
              title="Previous week"
              className="rounded-md p-1 text-txt3 hover:bg-surface hover:text-txt"
            >
              <ChevronsLeft className="h-4 w-4" />
            </button>
            {mode === "day" && (
              <>
                <button
                  onClick={() => shift(-1)}
                  title="Previous day"
                  className="rounded-md p-1 text-txt3 hover:bg-surface hover:text-txt"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  onClick={() => shift(1)}
                  title="Next day"
                  className="rounded-md p-1 text-txt3 hover:bg-surface hover:text-txt"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </>
            )}
            <button
              onClick={() => shiftWeek(1)}
              title="Next week"
              className="rounded-md p-1 text-txt3 hover:bg-surface hover:text-txt"
            >
              <ChevronsRight className="h-4 w-4" />
            </button>
          </div>
          <button
            onClick={() => setAnchor(new Date())}
            className="rounded-md border border-border px-2 py-1 text-[11px] text-txt2 hover:bg-surface"
          >
            Today
          </button>
          <div className="ml-1 flex overflow-hidden rounded-md border border-border text-[11px]">
            {(["day", "week"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={
                  m === mode
                    ? "px-2 py-1 font-medium text-white bg-accent"
                    : "px-2 py-1 text-txt2 hover:bg-surface"
                }
              >
                {m === "day" ? "Day" : "Week"}
              </button>
            ))}
          </div>
          {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-txt3" />}
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => setCreating(true)}
              className="flex items-center gap-1 rounded-md bg-accent px-2 py-1 text-[11px] font-medium text-white hover:bg-accentSoft"
            >
              <Plus className="h-3.5 w-3.5" /> Task
            </button>
            <input
              type="date"
              value={toISODate(anchor)}
              onChange={(e) =>
                e.target.value && setAnchor(new Date(`${e.target.value}T00:00:00`))
              }
              className="rounded-lg border border-border bg-surface px-2 py-1 text-[11px] text-txt2 outline-none focus:border-accent"
            />
          </div>
        </header>

        {/* mobile: title on its own row, controls on a second row, then an evenly-gridded 7-day strip */}
        <header className="shrink-0 border-b border-border px-4 pb-2 md:hidden">
          <div className="flex items-center gap-2 py-1">
            <h1 className="min-w-0 flex-1 text-lg font-semibold">
              {mode === "week" ? title : format(anchor, "EEEE, MMM d")}
            </h1>
            {loading && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-txt3" />}
            <button
              onClick={() => setCreating(true)}
              aria-label="Add task"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-white active:opacity-80"
            >
              <Plus className="h-4 w-4" />
            </button>
            <button
              onClick={() => setTasksOpen(true)}
              aria-label="Tasks"
              className="flex shrink-0 items-center gap-1 rounded-full border border-border px-3 py-1.5 text-xs text-txt2 active:bg-surface2"
            >
              <ListTodo className="h-3.5 w-3.5" />
              {overdue.length + dueToday.length + dueThisWeek.length}
            </button>
          </div>

          <div className="flex items-center gap-1 pb-1">
            <button
              onClick={() => setMode((m) => (m === "day" ? "week" : "day"))}
              className="rounded-full border border-border px-3 py-1.5 text-xs text-txt2 active:bg-surface2"
            >
              {mode === "day" ? "Week" : "Day"}
            </button>
            <button
              onClick={() => shiftWeek(-1)}
              aria-label="Previous week"
              className="flex h-9 w-9 items-center justify-center rounded-full text-txt2 active:bg-surface2"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button
              onClick={() => shiftWeek(1)}
              aria-label="Next week"
              className="flex h-9 w-9 items-center justify-center rounded-full text-txt2 active:bg-surface2"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
            <button
              onClick={() => setAnchor(new Date())}
              className="ml-auto rounded-full border border-border px-3 py-1.5 text-xs text-txt2 active:bg-surface2"
            >
              Today
            </button>
          </div>

          {/* a 7-column grid can't drift: every day gets exactly 1/7 of the width */}
          <div className="grid grid-cols-7">
            {strip.map((d) => {
              const sel = isSameDay(d, anchor);
              const isTd = isSameDay(d, new Date());
              return (
                <button
                  key={d.toISOString()}
                  onClick={() => {
                    setAnchor(d);
                    setMode("day");
                  }}
                  className="flex flex-col items-center gap-1 py-1.5 active:opacity-60"
                >
                  <span
                    className={clsx(
                      "text-[11px] font-medium uppercase",
                      sel ? "text-accent" : "text-txt3"
                    )}
                  >
                    {format(d, "EEEEE")}
                  </span>
                  <span
                    className={clsx(
                      "flex h-9 w-9 items-center justify-center rounded-full text-[15px] tabular-nums transition",
                      sel
                        ? "bg-accent font-semibold text-white"
                        : isTd
                          ? "font-semibold text-accent"
                          : "text-txt2"
                    )}
                  >
                    {format(d, "d")}
                  </span>
                </button>
              );
            })}
          </div>
        </header>

        <div
          className="min-h-0 flex-1 overflow-y-auto"
          onTouchStart={
            mode === "day"
              ? (e) => {
                  touchX.current = e.touches[0].clientX;
                }
              : undefined
          }
          onTouchEnd={
            mode === "day"
              ? (e) => {
                  if (touchX.current == null) return;
                  const dx = e.changedTouches[0].clientX - touchX.current;
                  if (Math.abs(dx) > 60) shiftWeek(dx < 0 ? 1 : -1);
                  touchX.current = null;
                }
              : undefined
          }
        >
          {mode === "week" ? (
            <>
              {weekLongTasks.length > 0 && (
                <div className="border-b border-txt3/10 px-4 pb-3 pt-4 md:px-6 md:pt-6">
                  <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-txt3">
                    This week
                  </p>
                  <div className="divide-y divide-txt3/10 rounded-lg border border-txt3/10">
                    {weekLongTasks.map((t) => (
                      <TaskRow key={t.id} t={t} list={weekLongTasks} />
                    ))}
                  </div>
                </div>
              )}
              {/* mobile: stays a vertical, one-day-at-a-time list */}
              <div className="mx-auto max-w-3xl divide-y divide-txt3/10 p-4 md:hidden">
                {days.map((day) => renderDayCell(day, false))}
              </div>
              {/* desktop: all 7 days fit on screen at once, no horizontal scrolling —
                  an equal-fraction grid with the compact/shrunk text in TaskRow and
                  renderDayCell (see `compact`/`horizontal` above) so narrow columns
                  stay readable instead of collapsing to one letter per line. */}
              <div className="hidden h-full grid-cols-7 items-start gap-2 p-4 md:grid md:p-6">
                {days.map((day, i) => (
                  <div
                    key={day.toISOString()}
                    className={clsx(
                      "min-w-0",
                      i < days.length - 1 && "border-r border-txt3/10 pr-2"
                    )}
                  >
                    {renderDayCell(day, true)}
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="mx-auto max-w-3xl p-4 md:p-6">
              {days.map((day) => renderDayCell(day, false))}
            </div>
          )}
        </div>
      </div>

      {/* task sidebar — collapsible on wide screens, drawer on small */}
      {sidebarOpen ? (
        <aside className="hidden w-[300px] shrink-0 border-l border-border lg:block">
          {taskPanel}
        </aside>
      ) : (
        <button
          onClick={() => setSidebarOpen(true)}
          title="Show your open tasks"
          className="hidden w-8 shrink-0 flex-col items-center gap-2 border-l border-border py-3 text-txt3 hover:bg-surface2 hover:text-txt lg:flex"
        >
          <PanelRightOpen className="h-3.5 w-3.5" />
          {overdue.length + dueToday.length + dueThisWeek.length + later.length + unscheduled.length > 0 && (
            <span className="rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-medium text-white">
              {overdue.length + dueToday.length + dueThisWeek.length + later.length + unscheduled.length}
            </span>
          )}
        </button>
      )}

      {tasksOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" onClick={() => setTasksOpen(false)}>
          <div className="absolute inset-0 bg-black/40" />
          <aside
            className="absolute right-0 top-0 h-full w-[85%] max-w-[340px] border-l border-border bg-surface"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <span className="text-sm font-semibold">Tasks</span>
              <button
                onClick={() => setTasksOpen(false)}
                className="rounded p-1 text-txt3 hover:bg-surface2 hover:text-txt"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="h-[calc(100%-49px)]">{taskPanel}</div>
          </aside>
        </div>
      )}

      {creating && (
        <TaskModal
          task={null}
          mode="create"
          projects={projectNames}
          currentUserId={currentUserId}
          defaultDueDate={toISODate(anchor)}
          onSave={createTask}
          onClose={() => setCreating(false)}
        />
      )}

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

      {editingTask && (
        <TaskModal
          task={editingTask}
          mode="edit"
          projects={projectNames}
          currentUserId={currentUserId}
          onSave={(patch) => updateTask(editingTask, patch)}
          onDelete={() => {
            deleteTask(editingTask);
            setEditingTask(null);
          }}
          onAddFollowUp={(dueDate, dueKind) =>
            addFollowUp({ title: editingTask.title, project: editingTask.project }, dueDate, dueKind)
          }
          onClose={() => setEditingTask(null)}
        />
      )}
    </div>
  );
}

function Bucket({
  title,
  count,
  danger,
  children,
}: {
  title: string;
  count: number;
  danger?: boolean;
  children: React.ReactNode;
}) {
  if (count === 0) return null;
  return (
    <div>
      <div
        className={clsx(
          "px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide",
          danger ? "text-danger" : "text-txt3"
        )}
      >
        {title} <span className="text-txt3">{count}</span>
      </div>
      {children}
    </div>
  );
}
