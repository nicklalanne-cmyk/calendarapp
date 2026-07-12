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
import {
  Plus,
  Trash2,
  CalendarDays,
  Eye,
  Pencil,
  Link2,
  ArrowLeft,
  Mic,
  PenLine,
  Type,
  Unlink,
  Plus as PlusIcon,
  CheckSquare,
  List,
  ListOrdered,
  ListChecks,
  Bold,
  Italic,
  Strikethrough,
  Heading2,
} from "lucide-react";
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
  const [linking, setLinking] = useState<false | "task" | "event" | "both">(false);
  const [transcribing, setTranscribing] = useState(false);
  const { settings } = useSettings();
  const inkDebouncer = useRef(makeDebouncer(900)).current;
  const [linkedTask, setLinkedTask] = useState<Task | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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

    let patch: Record<string, unknown>;
    let msg: string;

    if (link.kind === "task") {
      const t = link.task;
      patch = { task_id: t.id };
      msg = `Linked to task “${t.title}”`;

      // If the task is itself about a meeting, the note belongs to that meeting
      // too — that's the whole point of the chain. Don't clobber an event the
      // note is already linked to.
      if (t.linked_event_id && !active.event_id) {
        patch = {
          ...patch,
          event_id: t.linked_event_id,
          event_calendar_id: t.linked_event_calendar_id,
          event_account_id: t.linked_event_account_id,
          event_title: t.linked_event_title,
          event_start: t.linked_event_start,
        };
        msg = `Linked to “${t.title}” and its meeting`;
      }
    } else {
      patch = {
        event_id: link.id,
        event_calendar_id: link.calendarId,
        event_account_id: link.accountId,
        event_title: link.title,
        event_start: link.start,
      };
      msg = `Linked to “${link.title}”`;
    }

    const { error } = await supabase
      .from("notes")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", active.id);
    if (error) return toast(error.message, "error");

    setLinking(false);
    toast(msg);
    await load();
    const { data } = await supabase.from("notes").select("*").eq("id", active.id).single();
    if (data) setActive(data as Note);
  };

  const unlink = async (what: "task" | "event") => {
    if (!active) return;
    const patch =
      what === "task"
        ? { task_id: null }
        : {
            event_id: null,
            event_calendar_id: null,
            event_account_id: null,
            event_title: null,
            event_start: null,
          };
    const { error } = await supabase
      .from("notes")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", active.id);
    if (error) return toast(error.message, "error");
    if (what === "task") setLinkedTask(null);
    await load();
    const { data } = await supabase.from("notes").select("*").eq("id", active.id).single();
    if (data) setActive(data as Note);
    toast("Link removed");
  };

  // --- Bold / italic / strikethrough -----------------------------------------
  // Wraps the current selection in markdown emphasis markers, or — if it's
  // already wrapped — unwraps it (so tapping Bold again on bold text turns
  // it back off). With no selection, it drops in a placeholder that's
  // pre-selected so typing immediately replaces it.
  const wrapSelection = (marker: string) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const value = body;
    const selected = value.slice(start, end);
    const before = value.slice(Math.max(0, start - marker.length), start);
    const after = value.slice(end, end + marker.length);

    if (selected && before === marker && after === marker) {
      const newValue =
        value.slice(0, start - marker.length) + selected + value.slice(end + marker.length);
      setBody(newValue);
      requestAnimationFrame(() => {
        ta.focus();
        ta.selectionStart = start - marker.length;
        ta.selectionEnd = end - marker.length;
      });
      return;
    }

    const inner = selected || "text";
    const newValue = value.slice(0, start) + marker + inner + marker + value.slice(end);
    setBody(newValue);
    requestAnimationFrame(() => {
      ta.focus();
      ta.selectionStart = start + marker.length;
      ta.selectionEnd = start + marker.length + inner.length;
    });
  };

  // Toggles a "## " heading marker on the current line.
  const toggleHeading = () => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const value = body;
    const lineStart = value.lastIndexOf("\n", start - 1) + 1;
    let lineEnd = value.indexOf("\n", start);
    if (lineEnd === -1) lineEnd = value.length;
    const line = value.slice(lineStart, lineEnd);
    const isHeading = /^##\s/.test(line);
    const newLine = isHeading ? line.replace(/^##\s/, "") : `## ${line}`;
    const newValue = value.slice(0, lineStart) + newLine + value.slice(lineEnd);
    setBody(newValue);
    const delta = newLine.length - line.length;
    requestAnimationFrame(() => {
      ta.focus();
      ta.selectionStart = ta.selectionEnd = Math.max(lineStart, start + delta);
    });
  };

  // ⌘/Ctrl+B and ⌘/Ctrl+I work from a hardware keyboard too.
  const handleBodyKeyDownFormatting = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!(e.metaKey || e.ctrlKey)) return;
    if (e.key.toLowerCase() === "b") {
      e.preventDefault();
      wrapSelection("**");
    } else if (e.key.toLowerCase() === "i") {
      e.preventDefault();
      wrapSelection("_");
    }
  };

  // --- Easy lists -----------------------------------------------------------
  // Turns the selected line(s) — or just the current line, if nothing's
  // selected — into a bullet / numbered / checklist. Clicking the same
  // button again on an already-listed block toggles the markers back off.
  const BULLET_RE = /^(\s*)- (?!\[)/;
  const NUMBER_RE = /^(\s*)\d+\. /;
  const CHECK_RE = /^(\s*)- \[[ xX]\] /;
  const ANY_MARKER_RE = /^(\s*)(?:[-*] \[[ xX]\] |[-*] |\d+\. )/;

  const applyList = (kind: "bullet" | "number" | "check") => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const value = body;
    const lineStart = value.lastIndexOf("\n", start - 1) + 1;
    let lineEnd = value.indexOf("\n", end > start ? end - 1 : end);
    if (lineEnd === -1) lineEnd = value.length;
    const block = value.slice(lineStart, lineEnd);
    const lines = block.split("\n");
    const matcher = kind === "bullet" ? BULLET_RE : kind === "check" ? CHECK_RE : NUMBER_RE;
    const nonEmpty = lines.filter((l) => l.trim().length > 0);
    const alreadyThisKind = nonEmpty.length > 0 && nonEmpty.every((l) => matcher.test(l));

    let counter = 1;
    const newLines = lines.map((line) => {
      const m = line.match(ANY_MARKER_RE);
      const indent = m ? m[1] : (line.match(/^(\s*)/) ?? ["", ""])[1];
      const text = m ? line.slice(m[0].length) : line.slice(indent.length);
      if (alreadyThisKind) return `${indent}${text}`;
      if (line.trim().length === 0) return line;
      if (kind === "bullet") return `${indent}- ${text}`;
      if (kind === "check") return `${indent}- [ ] ${text}`;
      return `${indent}${counter++}. ${text}`;
    });

    const newBlock = newLines.join("\n");
    const newValue = value.slice(0, lineStart) + newBlock + value.slice(lineEnd);
    setBody(newValue);
    const delta = newBlock.length - block.length;
    requestAnimationFrame(() => {
      ta.focus();
      ta.selectionStart = start;
      ta.selectionEnd = Math.max(start, end + delta);
    });
  };

  // Pressing Enter inside a list item continues the same list on the next
  // line (bumping numbered-list counters); pressing Enter on an empty item
  // exits the list instead of adding another empty marker.
  const handleBodyKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Enter" || e.shiftKey) return;
    const ta = e.currentTarget;
    const { selectionStart, selectionEnd, value } = ta;
    if (selectionStart !== selectionEnd) return;
    const lineStart = value.lastIndexOf("\n", selectionStart - 1) + 1;
    const currentLine = value.slice(lineStart, selectionStart);

    const checkMatch = currentLine.match(/^(\s*)- \[[ xX]\] (.*)$/);
    const bulletMatch = !checkMatch && currentLine.match(/^(\s*)[-*] (.*)$/);
    const numberMatch = currentLine.match(/^(\s*)(\d+)\. (.*)$/);

    let prefix: string | null = null;
    let content = "";
    if (checkMatch) {
      prefix = `${checkMatch[1]}- [ ] `;
      content = checkMatch[2];
    } else if (bulletMatch) {
      prefix = `${bulletMatch[1]}- `;
      content = bulletMatch[2];
    } else if (numberMatch) {
      prefix = `${numberMatch[1]}${parseInt(numberMatch[2], 10) + 1}. `;
      content = numberMatch[3];
    }
    if (prefix === null) return;

    e.preventDefault();
    if (content.trim() === "") {
      const newValue = value.slice(0, lineStart) + value.slice(selectionStart);
      setBody(newValue);
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = lineStart;
      });
      return;
    }

    const insertion = `\n${prefix}`;
    const newValue = value.slice(0, selectionStart) + insertion + value.slice(selectionEnd);
    setBody(newValue);
    requestAnimationFrame(() => {
      const pos = selectionStart + insertion.length;
      ta.selectionStart = ta.selectionEnd = pos;
    });
  };

  // Lets you tap a "- [ ]" checkbox right in Preview mode instead of
  // switching to Edit to flip a "x" in by hand.
  const toggleCheckboxAtLine = (line1Indexed: number) => {
    const lines = body.split("\n");
    const idx = line1Indexed - 1;
    if (idx < 0 || idx >= lines.length) return;
    const l = lines[idx];
    if (/- \[ \] /.test(l)) lines[idx] = l.replace("- [ ] ", "- [x] ");
    else if (/- \[[xX]\] /.test(l)) lines[idx] = l.replace(/- \[[xX]\] /, "- [ ] ");
    else return;
    const next = lines.join("\n");
    setBody(next);
    if (active) {
      supabase
        .from("notes")
        .update({ body: next, updated_at: new Date().toISOString() })
        .eq("id", active.id)
        .then(() => load());
    }
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
        <LinkPicker
          only={linking === "both" ? undefined : linking}
          title={linking === "event" ? "Link this note to an event…" : "Link this note to a task…"}
          onClose={() => setLinking(false)}
          onPick={applyLink}
        />
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

              {linkedTask && (
                <span className="flex items-center gap-1.5 rounded-full bg-accent/15 py-1 pl-2.5 pr-1.5 text-accentSoft">
                  <CheckSquare className="h-3 w-3 shrink-0" />
                  <button
                    onClick={() => router.push("/app")}
                    className="max-w-[200px] truncate hover:underline"
                    title="Open in Planner"
                  >
                    {linkedTask.title}
                  </button>
                  <button
                    onClick={() => unlink("task")}
                    title="Unlink task"
                    className="rounded-full p-1 text-accentSoft/70 hover:bg-accent/20 hover:text-danger"
                  >
                    <Unlink className="h-3 w-3" />
                  </button>
                </span>
              )}

              {active.event_id && (
                <span className="flex items-center gap-1.5 rounded-full bg-accent/15 py-1 pl-2.5 pr-1.5 text-accentSoft">
                  <CalendarDays className="h-3 w-3 shrink-0" />
                  <button
                    onClick={() => router.push("/app/agenda")}
                    className="max-w-[220px] truncate hover:underline"
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
                    onClick={() => unlink("event")}
                    title="Unlink event"
                    className="rounded-full p-1 text-accentSoft/70 hover:bg-accent/20 hover:text-danger"
                  >
                    <Unlink className="h-3 w-3" />
                  </button>
                </span>
              )}

              {!linkedTask && (
                <button
                  onClick={() => setLinking("task")}
                  className="flex items-center gap-1.5 rounded-full border border-dashed border-border px-2.5 py-1 text-txt3 transition hover:border-accent hover:text-accent"
                >
                  <CheckSquare className="h-3 w-3" /> Link a task
                </button>
              )}
              {!active.event_id && (
                <button
                  onClick={() => setLinking("event")}
                  className="flex items-center gap-1.5 rounded-full border border-dashed border-border px-2.5 py-1 text-txt3 transition hover:border-accent hover:text-accent"
                >
                  <CalendarDays className="h-3 w-3" /> Link an event
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
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    input: ({ node, ...props }) => {
                      if (props.type !== "checkbox") return <input {...props} />;
                      const line = (node as unknown as { position?: { start?: { line?: number } } })
                        ?.position?.start?.line;
                      return (
                        <input
                          {...props}
                          disabled={false}
                          onChange={() => (line ? toggleCheckboxAtLine(line) : undefined)}
                          className="mr-1.5 h-3.5 w-3.5 accent-accent"
                        />
                      );
                    },
                  }}
                >
                  {body || "*Nothing yet.*"}
                </ReactMarkdown>
              </div>
            ) : (
              <>
                <div className="-mx-1 mb-2 flex items-center gap-0.5 overflow-x-auto px-1">
                  <ToolbarButton title="Bold (⌘B)" onClick={() => wrapSelection("**")}>
                    <Bold className="h-4 w-4" />
                  </ToolbarButton>
                  <ToolbarButton title="Italic (⌘I)" onClick={() => wrapSelection("_")}>
                    <Italic className="h-4 w-4" />
                  </ToolbarButton>
                  <ToolbarButton title="Strikethrough" onClick={() => wrapSelection("~~")}>
                    <Strikethrough className="h-4 w-4" />
                  </ToolbarButton>
                  <ToolbarButton title="Heading" onClick={toggleHeading}>
                    <Heading2 className="h-4 w-4" />
                  </ToolbarButton>
                  <div className="mx-1 h-5 w-px shrink-0 bg-border" />
                  <ToolbarButton title="Bullet list" onClick={() => applyList("bullet")}>
                    <List className="h-4 w-4" />
                  </ToolbarButton>
                  <ToolbarButton title="Numbered list" onClick={() => applyList("number")}>
                    <ListOrdered className="h-4 w-4" />
                  </ToolbarButton>
                  <ToolbarButton title="Checklist" onClick={() => applyList("check")}>
                    <ListChecks className="h-4 w-4" />
                  </ToolbarButton>
                </div>
                <textarea
                  ref={textareaRef}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  onBlur={save}
                  onKeyDown={(e) => {
                    handleBodyKeyDownFormatting(e);
                    if (!e.defaultPrevented) handleBodyKeyDown(e);
                  }}
                  placeholder="Write in markdown — # heading, **bold**, - list, [ ] todo…"
                  className="flex-1 resize-none bg-transparent font-mono text-[15px] leading-relaxed outline-none placeholder:text-txt3 md:text-sm"
                />
              </>
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

function ToolbarButton({
  title,
  onClick,
  children,
}: {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()} // keep the textarea's selection intact on tap
      onClick={onClick}
      title={title}
      aria-label={title}
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-txt2 active:bg-surface2 md:h-7 md:w-7 md:hover:bg-surface"
    >
      {children}
    </button>
  );
}
