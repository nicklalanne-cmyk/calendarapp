"use client";
import clsx from "clsx";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import VoiceMemo from "@/components/notes/VoiceMemo";
import InkCanvas from "@/components/notes/InkCanvas";
import LinkPicker, { type NoteLink } from "@/components/notes/LinkPicker";
import { renderToPng, type Stroke } from "@/lib/ink";
import { useSettings } from "@/components/SettingsProvider";
import { makeDebouncer } from "@/lib/debounce";
import AudioNote from "@/components/notes/AudioNote";
import { format } from "date-fns";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Plus, Trash2, CalendarDays, Eye, Pencil, Link2, ArrowLeft, Mic, PenLine, Type, Unlink, Plus as PlusIcon, CheckSquare } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/lib/toast";
import type { Note, Task } from "@/lib/types";

export default function NotesView() {
  const supabase = createClient();
  const [notes, setNotes] = useState<Note[]>([]);
  const [active, setActive] = useState<Note | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [preview, setPreview] = useState(false);
  const [recording, setRecording] = useState(false);
  const [mode, setMode] = useState<"text" | "ink">("text");
  const [linking, setLinking] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const { settings } = useSettings();
  const inkDebouncer = useRef(makeDebouncer(900)).current;
  const [linkedTask, setLinkedTask] = useState<Task | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("notes")
      .select("*")
      .is("deleted_at", null)
      .order("updated_at", { ascending: false });
    setNotes((data as Note[]) ?? []);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  // live sync
  useEffect(() => {
    const ch = supabase
      .channel("notes-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "notes" }, () => load())
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [supabase, load]);

  const select = useCallback(
    async (n: Note) => {
      setActive(n);
      setTitle(n.title);
      setBody(n.body);
      setPreview(false);
      setLinkedTask(null);
      if (n.task_id) {
        const { data } = await supabase.from("tasks").select("*").eq("id", n.task_id).maybeSingle();
        setLinkedTask((data as Task) ?? null);
      }
    },
    [supabase]
  );

  // deep-link ?note=<id>
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("note");
    if (!id || notes.length === 0) return;
    const n = notes.find((x) => x.id === id);
    if (n && active?.id !== id) {
      select(n);
      window.history.replaceState({}, "", "/app/notes");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes]);

  const router = useRouter();
  const params = useSearchParams();
  const wantsNew = params.get("new") === "1";
  const wantsRecord = params.get("record") === "1";
  const [spawned, setSpawned] = useState(false);

  const createNote = async () => {
    const { data } = await supabase.from("notes").insert({ title: "", body: "" }).select().single();
    if (data) {
      await load();
      select(data as Note);
    }
  };

  const openDailyNote = async () => {
    const todayStr = format(new Date(), "yyyy-MM-dd");
    const { data: existing } = await supabase
      .from("notes")
      .select("*")
      .eq("note_date", todayStr)
      .limit(1);
    if (existing && existing.length) {
      select(existing[0] as Note);
      return;
    }
    const { data } = await supabase
      .from("notes")
      .insert({ title: format(new Date(), "EEEE, MMM d yyyy"), body: "", note_date: todayStr })
      .select()
      .single();
    if (data) {
      await load();
      select(data as Note);
    }
  };

  const save = async () => {
    if (!active) return;
    await supabase
      .from("notes")
      .update({ title, body, updated_at: new Date().toISOString() })
      .eq("id", active.id);
    load();
  };

  const saveInk = (strokes: Stroke[], h: number) => {
    if (!active) return;
    const id = active.id;
    inkDebouncer.run(`ink:${id}`, async () => {
      const { error } = await supabase
        .from("notes")
        .update({ ink: { v: 1, strokes }, ink_height: h, updated_at: new Date().toISOString() })
        .eq("id", id);
      if (error) toast(error.message, "error");
    });
  };

  const transcribeInk = async (strokes: Stroke[], h: number) => {
    if (!active || strokes.length === 0) return;
    setTranscribing(true);
    try {
      // 1.4x gives the model more pixels to read without blowing the size limit
      const png = renderToPng(strokes, h, 1.4);
      if (!png) throw new Error("Couldn't render the page");

      const res = await fetch("/api/ai/handwriting", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: png }),
      });
      const j = await res.json();
      if (!res.ok) {
        toast(j.error ?? "Couldn't read the handwriting", "error");
        return;
      }
      const text = (j.text ?? "").trim();
      if (!text) {
        toast("Nothing legible on the page", "error");
        return;
      }

      // append rather than overwrite — never destroy what's already typed
      const next = body.trim() ? `${body.trim()}\n\n${text}` : text;
      setBody(next);
      const { error } = await supabase
        .from("notes")
        .update({ body: next, updated_at: new Date().toISOString() })
        .eq("id", active.id);
      if (error) toast(error.message, "error");
      else {
        toast("Handwriting converted — check it before you trust it");
        setMode("text");
        load();
      }
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setTranscribing(false);
    }
  };

  const applyLink = async (link: NoteLink) => {
    if (!active) return;
    const patch =
      link.kind === "task"
        ? {
            task_id: link.task.id,
            event_id: null,
            event_calendar_id: null,
            event_account_id: null,
            event_title: null,
            event_start: null,
          }
        : {
            task_id: null,
            event_id: link.id,
            event_calendar_id: link.calendarId,
            event_account_id: link.accountId,
            event_title: link.title,
            event_start: link.start,
          };

    const { error } = await supabase
      .from("notes")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", active.id);
    if (error) return toast(error.message, "error");

    setLinking(false);
    toast(
      link.kind === "task"
        ? `Linked to task “${link.task.title}”`
        : `Linked to “${link.title}”`
    );
    await load();
    const { data } = await supabase.from("notes").select("*").eq("id", active.id).single();
    if (data) setActive(data as Note);
  };

  const unlink = async () => {
    if (!active) return;
    const { error } = await supabase
      .from("notes")
      .update({
        task_id: null,
        event_id: null,
        event_calendar_id: null,
        event_account_id: null,
        event_title: null,
        event_start: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", active.id);
    if (error) return toast(error.message, "error");
    setLinkedTask(null);
    await load();
    const { data } = await supabase.from("notes").select("*").eq("id", active.id).single();
    if (data) setActive(data as Note);
    toast("Link removed");
  };

  const remove = async (n: Note) => {
    const { error } = await supabase
      .from("notes")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", n.id);
    if (error) return toast(error.message, "error");

    if (active?.id === n.id) {
      setActive(null);
      setTitle("");
      setBody("");
    }
    load();

    toast(`Deleted “${n.title || "Untitled"}”`, {
      action: {
        label: "Undo",
        run: async () => {
          const { error: e } = await supabase
            .from("notes")
            .update({ deleted_at: null })
            .eq("id", n.id);
          if (e) return toast(e.message, "error");
          toast("Restored");
          load();
        },
      },
    });
  };

  useEffect(() => {
    if (spawned) return;
    if (wantsNew) {
      setSpawned(true);
      createNote();
      window.history.replaceState(null, "", "/app/notes");
    } else if (wantsRecord) {
      setSpawned(true);
      setRecording(true);
      window.history.replaceState(null, "", "/app/notes");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantsNew, wantsRecord, spawned]);

  return (
    <div className="flex h-full">
      {linking && (
        <LinkPicker onClose={() => setLinking(false)} onPick={applyLink} />
      )}

      <VoiceMemo
        open={recording}
        onClose={() => setRecording(false)}
        onCreated={async (id) => {
          setRecording(false);
          await load();
          const { data } = await supabase.from("notes").select("*").eq("id", id).single();
          if (data) setActive(data as Note);
        }}
      />
      <aside
        className={`${active ? "hidden md:flex" : "flex"} w-full shrink-0 flex-col border-r border-border p-3 md:w-72`}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-txt md:text-sm md:uppercase md:tracking-wide md:text-txt3">
            Notes
          </h2>
          <div className="flex items-center gap-1">
            <button
              onClick={openDailyNote}
              title="Today's daily note"
              aria-label="Today's daily note"
              className="flex h-11 w-11 items-center justify-center rounded-xl text-txt2 active:bg-surface2 md:h-8 md:w-8 md:hover:bg-surface"
            >
              <CalendarDays className="h-[22px] w-[22px] md:h-4 md:w-4" />
            </button>
            <button
              onClick={() => setRecording(true)}
              title="Record a voice memo"
              aria-label="Record a voice memo"
              className="flex h-11 w-11 items-center justify-center rounded-xl text-danger active:bg-surface2 md:h-8 md:w-8 md:hover:bg-surface"
            >
              <Mic className="h-[22px] w-[22px] md:h-4 md:w-4" />
            </button>
            <button
              onClick={createNote}
              title="New note"
              aria-label="New note"
              className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent text-white active:opacity-80 md:h-8 md:w-8 md:bg-transparent md:text-txt2 md:hover:bg-surface"
            >
              <Plus className="h-[22px] w-[22px] md:h-4 md:w-4" />
            </button>
          </div>
        </div>
        <div className="flex-1 space-y-1 overflow-y-auto">
          {notes.map((n) => (
            <button
              key={n.id}
              onClick={() => select(n)}
              className={`flex w-full items-start gap-2 rounded-lg px-2 py-3 text-left md:py-2 ${
                active?.id === n.id ? "bg-surface3" : "hover:bg-surface"
              }`}
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-[15px] md:text-sm">{n.title || "Untitled"}</div>
                <div className="truncate text-[13px] text-txt3 md:text-xs">{n.body || "No content"}</div>
                <div className="flex items-center gap-1.5 pt-0.5">
                  {n.note_date && <CalendarDays className="h-3 w-3 text-accentSoft" />}
                  {n.task_id && <CheckSquare className="h-3 w-3 text-accentSoft" />}
                  {n.event_id && <Link2 className="h-3 w-3 text-accentSoft" />}
                  {n.ink && ((n.ink.strokes?.length ?? 0) > 0) && (
                    <PenLine className="h-3 w-3 text-accentSoft" />
                  )}
                </div>
              </div>
            </button>
          ))}
          {notes.length === 0 && (
            <p className="px-2 py-6 text-center text-xs text-txt3">No notes yet.</p>
          )}
        </div>
      </aside>

      <section
        className={`${active ? "flex" : "hidden md:flex"} min-w-0 flex-1 flex-col overflow-hidden p-4 md:p-6`}
      >
        {active ? (
          <>
            <div className="mb-2 flex items-center gap-2">
              <button
                onClick={() => setActive(null)}
                aria-label="Back to notes"
                className="-ml-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-txt2 active:bg-surface2 md:hidden"
              >
                <ArrowLeft className="h-6 w-6" />
              </button>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={save}
                placeholder="Title"
                className="min-w-0 flex-1 bg-transparent text-xl font-semibold outline-none placeholder:text-txt3 md:text-2xl"
              />
              <button
                onClick={() => setPreview((v) => !v)}
                className="flex shrink-0 items-center gap-1 rounded-lg border border-border px-3 py-2 text-[13px] text-txt2 active:bg-surface2 md:px-2 md:py-1 md:text-xs md:hover:bg-surface"
              >
                {preview ? <Pencil className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                {preview ? "Edit" : "Preview"}
              </button>
            </div>

            <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
              {active.note_date && (
                <span className="flex items-center gap-1 rounded-full bg-surface px-2.5 py-1 text-txt3">
                  <CalendarDays className="h-3 w-3" /> Daily note ·{" "}
                  {format(new Date(`${active.note_date}T00:00:00`), "MMM d, yyyy")}
                </span>
              )}

              {linkedTask ? (
                <span className="group/link flex items-center gap-1.5 rounded-full bg-accent/15 py-1 pl-2.5 pr-1.5 text-accentSoft">
                  <CheckSquare className="h-3 w-3 shrink-0" />
                  <button
                    onClick={() => router.push("/app")}
                    className="max-w-[220px] truncate hover:underline"
                    title="Open in Planner"
                  >
                    {linkedTask.title}
                  </button>
                  <button
                    onClick={unlink}
                    title="Remove link"
                    className="rounded-full p-1 text-accentSoft/70 hover:bg-accent/20 hover:text-danger"
                  >
                    <Unlink className="h-3 w-3" />
                  </button>
                </span>
              ) : active.event_id ? (
                <span className="group/link flex items-center gap-1.5 rounded-full bg-accent/15 py-1 pl-2.5 pr-1.5 text-accentSoft">
                  <CalendarDays className="h-3 w-3 shrink-0" />
                  <button
                    onClick={() => router.push("/app/agenda")}
                    className="max-w-[240px] truncate hover:underline"
                    title="Open in Agenda"
                  >
                    {active.event_title || "Event"}
                    {active.event_start && (
                      <span className="ml-1 opacity-70">
                        ·{" "}
                        {new Date(active.event_start).toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                        })}
                      </span>
                    )}
                  </button>
                  <button
                    onClick={unlink}
                    title="Remove link"
                    className="rounded-full p-1 text-accentSoft/70 hover:bg-accent/20 hover:text-danger"
                  >
                    <Unlink className="h-3 w-3" />
                  </button>
                </span>
              ) : (
                <button
                  onClick={() => setLinking(true)}
                  className="flex items-center gap-1.5 rounded-full border border-dashed border-border px-2.5 py-1 text-txt3 transition hover:border-accent hover:text-accent"
                >
                  <Link2 className="h-3 w-3" /> Link to a task or event
                </button>
              )}
            </div>

            {active.audio_path && (
              <AudioNote
                path={active.audio_path}
                seconds={active.duration_seconds}
                transcript={active.transcript}
              />
            )}

            {settings.handwriting_enabled && (
              <div className="mb-3 flex w-fit items-center gap-0.5 rounded-lg bg-surface2 p-0.5">
                <button
                  onClick={() => setMode("text")}
                  className={clsx(
                    "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs transition",
                    mode === "text" ? "bg-surface text-txt shadow-sm" : "text-txt3"
                  )}
                >
                  <Type className="h-3.5 w-3.5" /> Text
                </button>
                <button
                  onClick={() => setMode("ink")}
                  className={clsx(
                    "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs transition",
                    mode === "ink" ? "bg-surface text-txt shadow-sm" : "text-txt3"
                  )}
                >
                  <PenLine className="h-3.5 w-3.5" /> Handwriting
                  {active.ink && (active.ink.strokes?.length ?? 0) > 0 && (
                    <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                  )}
                </button>
              </div>
            )}

            {settings.handwriting_enabled && mode === "ink" ? (
              <InkCanvas
                key={active.id}
                initial={(active.ink?.strokes as Stroke[]) ?? []}
                initialHeight={active.ink_height}
                onChange={saveInk}
                onTranscribe={transcribeInk}
                transcribing={transcribing}
              />
            ) : preview ? (
              <div className="prose-cadence flex-1 overflow-y-auto text-sm leading-relaxed">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{body || "*Nothing yet.*"}</ReactMarkdown>
              </div>
            ) : (
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                onBlur={save}
                placeholder="Write in markdown — # heading, **bold**, - list, [ ] todo…"
                className="flex-1 resize-none bg-transparent font-mono text-[15px] leading-relaxed outline-none placeholder:text-txt3 md:text-sm"
              />
            )}

            <div className="mt-3 flex items-center gap-3 text-xs text-txt3">
              <button onClick={save} className="rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white md:px-3 md:py-1 md:text-xs">
                Save
              </button>
              <button onClick={() => remove(active)} className="flex items-center gap-1.5 rounded-lg px-3 py-2.5 text-sm active:bg-surface2 hover:text-danger md:px-0 md:py-0 md:text-xs">
                <Trash2 className="h-3.5 w-3.5" /> Delete
              </button>
              <span className="ml-auto">
                Updated {format(new Date(active.updated_at), "MMM d, h:mm a")}
              </span>
            </div>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-txt3">
            Select a note, or create one.
          </div>
        )}
      </section>
    </div>
  );
}
