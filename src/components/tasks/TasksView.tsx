"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Hash, SlidersHorizontal, ChevronDown, ChevronRight } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Task } from "@/lib/types";
import TaskItem from "@/components/tasks/TaskItem";
import TaskModal, { type TaskDraft } from "@/components/tasks/TaskModal";
import ScheduleSheet from "@/components/tasks/ScheduleSheet";
import { parseTaskInput, nextDue, type ParsedTask } from "@/lib/tasks";
import { toast } from "@/lib/toast";
import { fireTaskCreated, fireTaskUpdated, fireTaskCompleted } from "@/lib/automations";

// A flat, un-bucketed view of every task — unlike Planner's TaskList (which
// splits into Overdue/Today/This week/Upcoming/Inbox sections) or Agenda
// (which filters by the day/week currently in view), this page just shows
// everything: unscheduled tasks first, then everything with a due date in
// chronological order. Meant as a single "what do I have, total" list.
export default function TasksView() {
  const supabase = createClient();
  const router = useRouter();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [value, setValue] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [projectFilter, setProjectFilter] = useState<string | null>(null);
  const [editing, setEditing] = useState<Task | null>(null);
  const [creating, setCreating] = useState(false);
  const [scheduling, setScheduling] = useState<Task | null>(null);
  const [showCompleted, setShowCompleted] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: u }) => setCurrentUserId(u.user?.id ?? null));
  }, [supabase]);

  const loadTasks = useCallback(async () => {
    const { data, error } = await supabase
      .from("tasks")
      .select("*")
      .is("deleted_at", null)
      .order("created_at", { ascending: false });
    if (error) toast(error.message, "error");
    setTasks((data as Task[]) ?? []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);
  useEffect(() => {
    const h = () => loadTasks();
    window.addEventListener("cadence:tasks-changed", h);
    return () => window.removeEventListener("cadence:tasks-changed", h);
  }, [loadTasks]);
  useEffect(() => {
    const channel = supabase
      .channel("tasks-view-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks" }, () => loadTasks())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, loadTasks]);

  // Subtasks inherit their parent's due date/kind at creation and get
  // cascaded to match whenever the parent's is changed — see the same helper
  // in Planner.tsx and AgendaView.tsx.
  const cascadeDueToSubtasks = async (parentId: string, due_date: string | null, due_kind: "day" | "week") => {
    const childIds = tasks.filter((x) => x.parent_id === parentId).map((x) => x.id);
    if (childIds.length === 0) return;
    setTasks((cur) => cur.map((x) => (childIds.includes(x.id) ? { ...x, due_date, due_kind } : x)));
    const { error } = await supabase.from("tasks").update({ due_date, due_kind }).in("id", childIds);
    if (error) toast(error.message, "error");
  };

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
      })
      .select()
      .single();
    if (error) return toast(error.message, "error");
    if (data) await fireTaskCreated(supabase, data as Task);
    setCreating(false);
    loadTasks();
  };

  const addSubtask = async (parent: Task, title: string) => {
    const { error } = await supabase.from("tasks").insert({
      title,
      parent_id: parent.id,
      project: parent.project,
      due_date: parent.due_date,
      due_kind: parent.due_kind ?? "day",
    });
    if (error) return toast(error.message, "error");
    loadTasks();
  };

  const editSubtaskTitle = async (t: Task, title: string) => {
    setTasks((cur) => cur.map((x) => (x.id === t.id ? { ...x, title } : x)));
    const { error } = await supabase.from("tasks").update({ title }).eq("id", t.id);
    if (error) {
      setTasks((cur) => cur.map((x) => (x.id === t.id ? { ...x, title: t.title } : x)));
      return toast(error.message, "error");
    }
    loadTasks();
  };

  const toggleTask = async (t: Task) => {
    const completing = !t.is_done;
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
    const childIds = tasks.filter((x) => x.parent_id === t.id).map((x) => x.id);
    const idsToDelete = [t.id, ...childIds];
    setTasks((cur) => cur.filter((x) => !idsToDelete.includes(x.id)));
    const { error } = await supabase
      .from("tasks")
      .update({ deleted_at: new Date().toISOString() })
      .in("id", idsToDelete);
    if (error) {
      loadTasks();
      return toast(error.message, "error");
    }
    loadTasks();
    toast(
      childIds.length > 0
        ? `Deleted "${t.title}" and ${childIds.length} subtask${childIds.length === 1 ? "" : "s"}`
        : `Deleted "${t.title}"`,
      {
        action: {
          label: "Undo",
          run: async () => {
            const { error: e } = await supabase.from("tasks").update({ deleted_at: null }).in("id", idsToDelete);
            if (e) return toast(e.message, "error");
            toast("Restored");
            loadTasks();
          },
        },
      }
    );
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
    void linked_event;
    const patch = rest;

    if (scope === "occurrence" && (t.rrule || t.repeat)) {
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

    if (patch.due_date !== t.due_date || patch.due_kind !== (t.due_kind ?? "day")) {
      await cascadeDueToSubtasks(t.id, patch.due_date ?? null, patch.due_kind ?? "day");
    }

    await fireTaskUpdated(supabase, {
      id: t.id,
      title: patch.title ?? t.title,
      project: patch.project ?? t.project,
      tags: patch.tags ?? t.tags,
      priority: patch.priority ?? t.priority,
      due_date: patch.due_date ?? t.due_date,
    });
    loadTasks();
  };

  const scheduleTask = async (t: Task, start: Date, end: Date) => {
    const { error } = await supabase
      .from("tasks")
      .update({ scheduled_start: start.toISOString(), scheduled_end: end.toISOString() })
      .eq("id", t.id);
    if (error) return toast(error.message, "error");
    setScheduling(null);
    toast(
      `Scheduled for ${start.toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}`
    );
    loadTasks();
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

  const submit = () => {
    const v = value.trim();
    if (!v) return;
    addTask(parseTaskInput(v));
    setValue("");
  };

  const children = new Map<string, Task[]>();
  for (const t of tasks) {
    if (t.parent_id) {
      if (!children.has(t.parent_id)) children.set(t.parent_id, []);
      children.get(t.parent_id)!.push(t);
    }
  }

  const projects = Array.from(
    new Set(tasks.filter((t) => !t.parent_id && t.project).map((t) => t.project as string))
  ).sort();

  const searchQ = searchQuery.trim().toLowerCase();
  const top = tasks
    .filter((t) => !t.parent_id)
    .filter((t) => (projectFilter ? t.project === projectFilter : true))
    .filter((t) =>
      searchQ
        ? t.title.toLowerCase().includes(searchQ) ||
          (t.notes ?? "").toLowerCase().includes(searchQ) ||
          (t.tags ?? []).some((tag) => tag.toLowerCase().includes(searchQ))
        : true
    );

  const open = top.filter((t) => !t.is_done);
  const unscheduled = open.filter((t) => !t.due_date);
  const scheduled = open
    .filter((t) => t.due_date)
    .sort((a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? "") || (a.priority || 99) - (b.priority || 99));
  const completed = top
    .filter((t) => t.is_done)
    .sort((a, b) => (b.due_date ?? "").localeCompare(a.due_date ?? ""));

  const empty = top.length === 0;

  return (
    <div className="mx-auto h-full max-w-2xl overflow-y-auto px-4 py-6 md:px-8">
      <h1 className="mb-4 text-2xl font-semibold">Tasks</h1>

      <div className="mb-2 flex items-center gap-1.5 rounded-lg border border-border bg-surface pl-2 pr-1">
        <Plus className="h-4 w-4 shrink-0 text-txt3" />
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="Add task — “#work ~45m every other thursday p1”"
          className="min-w-0 flex-1 bg-transparent py-3 text-[15px] outline-none placeholder:text-txt3 md:py-2 md:text-sm"
        />
        <button
          onClick={() => setCreating(true)}
          title="Add with all the details"
          className="shrink-0 rounded-lg p-2.5 text-txt3 transition active:bg-surface2 md:p-1.5 md:hover:bg-surface2 md:hover:text-txt"
        >
          <SlidersHorizontal className="h-[18px] w-[18px] md:h-3.5 md:w-3.5" />
        </button>
      </div>

      <input
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        placeholder="Search tasks…"
        className="mb-2 w-full rounded-lg border border-border bg-surface px-2.5 py-2 text-sm outline-none focus:border-accent md:py-1.5"
      />

      {projects.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-1">
          {projects.map((p) => (
            <button
              key={p}
              onClick={() => setProjectFilter(projectFilter === p ? null : p)}
              className={`flex items-center gap-0.5 rounded-full px-3 py-1.5 text-xs md:px-2 md:py-0.5 md:text-[11px] ${
                projectFilter === p ? "bg-accent text-white" : "bg-surface text-txt3 hover:text-txt"
              }`}
            >
              <Hash className="h-2.5 w-2.5" />
              {p}
            </button>
          ))}
          <button
            onClick={() => setProjectFilter(null)}
            className={`rounded-full px-3 py-1.5 text-xs md:px-2 md:py-0.5 md:text-[11px] ${
              projectFilter === null ? "bg-accent text-white" : "bg-surface text-txt3 hover:text-txt"
            }`}
          >
            All
          </button>
        </div>
      )}

      {loading ? (
        <p className="px-2 py-6 text-center text-xs text-txt3">Loading…</p>
      ) : empty ? (
        <p className="px-2 py-6 text-center text-xs text-txt3">
          No tasks yet. Try “review deck #work tomorrow p1”, or use the sliders for the full form.
        </p>
      ) : (
        <>
          {unscheduled.length > 0 && (
            <div className="mb-4">
              <p className="mb-1 px-1.5 text-[11px] font-semibold uppercase tracking-wide text-txt3">
                Unscheduled <span className="text-txt3">{unscheduled.length}</span>
              </p>
              {unscheduled.map((t) => (
                <TaskItem
                  key={t.id}
                  task={t}
                  subtasks={children.get(t.id) ?? []}
                  onToggle={toggleTask}
                  onDelete={deleteTask}
                  onCyclePriority={cyclePriority}
                  onAddSubtask={addSubtask}
                  onEditSubtask={editSubtaskTitle}
                  onOpenNote={openNoteForTask}
                  onOpenTask={(x) => setEditing(x)}
                  onSchedule={(x) => setScheduling(x)}
                />
              ))}
            </div>
          )}
          {scheduled.length > 0 && (
            <div className="mb-4">
              <p className="mb-1 px-1.5 text-[11px] font-semibold uppercase tracking-wide text-txt3">
                Scheduled <span className="text-txt3">{scheduled.length}</span>
              </p>
              {scheduled.map((t) => (
                <TaskItem
                  key={t.id}
                  task={t}
                  subtasks={children.get(t.id) ?? []}
                  onToggle={toggleTask}
                  onDelete={deleteTask}
                  onCyclePriority={cyclePriority}
                  onAddSubtask={addSubtask}
                  onEditSubtask={editSubtaskTitle}
                  onOpenNote={openNoteForTask}
                  onOpenTask={(x) => setEditing(x)}
                  onSchedule={(x) => setScheduling(x)}
                />
              ))}
            </div>
          )}
          {completed.length > 0 && (
            <div className="mb-4">
              <button
                onClick={() => setShowCompleted((v) => !v)}
                className="mb-1 flex w-full items-center gap-1 px-1.5 text-[11px] font-semibold uppercase tracking-wide text-txt3"
              >
                {showCompleted ? (
                  <ChevronDown className="h-3 w-3 shrink-0" />
                ) : (
                  <ChevronRight className="h-3 w-3 shrink-0" />
                )}
                {showCompleted ? "Completed" : "See completed tasks"}{" "}
                <span className="text-txt3">{completed.length}</span>
              </button>
              {showCompleted &&
                completed.map((t) => (
                  <TaskItem
                    key={t.id}
                    task={t}
                    subtasks={children.get(t.id) ?? []}
                    onToggle={toggleTask}
                    onDelete={deleteTask}
                    onCyclePriority={cyclePriority}
                    onAddSubtask={addSubtask}
                    onEditSubtask={editSubtaskTitle}
                    onOpenNote={openNoteForTask}
                    onOpenTask={(x) => setEditing(x)}
                    onSchedule={(x) => setScheduling(x)}
                  />
                ))}
            </div>
          )}
        </>
      )}

      {editing && (
        <TaskModal
          task={editing}
          mode="edit"
          projects={projects}
          allTags={Array.from(new Set(tasks.flatMap((t) => t.tags ?? []).filter(Boolean))).sort()}
          currentUserId={currentUserId}
          onSave={(patch) => updateTask(editing, patch)}
          onDelete={() => {
            deleteTask(editing);
            setEditing(null);
          }}
          onAddFollowUp={async (dueDate, dueKind) => {
            const { error } = await supabase.from("tasks").insert({
              title: `Follow up: ${editing.title}`,
              due_date: dueDate,
              due_kind: dueKind,
              priority: 0,
              project: editing.project ?? null,
              shared: false,
            });
            if (error) return toast(error.message, "error");
            toast(`Follow-up added for ${dueDate}`);
            loadTasks();
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
          projects={projects}
          allTags={Array.from(new Set(tasks.flatMap((t) => t.tags ?? []).filter(Boolean))).sort()}
          currentUserId={currentUserId}
          onSave={createTask}
          onClose={() => setCreating(false)}
        />
      )}
    </div>
  );
}
