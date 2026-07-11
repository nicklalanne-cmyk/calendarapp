"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, Square, X, Loader2, Check, Sparkles } from "lucide-react";
import clsx from "clsx";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/lib/toast";

type Phase = "idle" | "recording" | "saving" | "done";

function getRecognition(): any | null {
  if (typeof window === "undefined") return null;
  const Ctor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  if (!Ctor) return null;
  const r = new Ctor();
  r.continuous = true; // a memo can be long — don't cut out on the first pause
  r.interimResults = true;
  r.lang = navigator.language || "en-US";
  return r;
}

function fmt(s: number) {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export default function VoiceMemo({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (noteId: string) => void;
}) {
  const supabase = createClient();
  const [phase, setPhase] = useState<Phase>("idle");
  const [seconds, setSeconds] = useState(0);
  const [transcript, setTranscript] = useState("");
  const [status, setStatus] = useState("");
  const [madeTasks, setMadeTasks] = useState<string[]>([]);

  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const rec = useRef<any>(null);
  const finalText = useRef("");
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopped = useRef(false);

  const cleanup = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    try {
      rec.current?.abort?.();
    } catch {
      /* ignore */
    }
    recorder.current?.stream.getTracks().forEach((t) => t.stop());
    recorder.current = null;
    rec.current = null;
  }, []);

  const start = useCallback(async () => {
    finalText.current = "";
    stopped.current = false;
    setTranscript("");
    setSeconds(0);
    setMadeTasks([]);

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      toast("Microphone permission denied", "error");
      onClose();
      return;
    }

    // 1. capture the actual audio, so the memo is never lost to a bad transcript
    const mime = MediaRecorder.isTypeSupported("audio/webm")
      ? "audio/webm"
      : MediaRecorder.isTypeSupported("audio/mp4")
        ? "audio/mp4"
        : "";
    const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    chunks.current = [];
    mr.ondataavailable = (e) => e.data.size > 0 && chunks.current.push(e.data);
    mr.start(1000);
    recorder.current = mr;

    // 2. transcribe live, in parallel
    const r = getRecognition();
    if (r) {
      r.onresult = (e: any) => {
        let interim = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const t = e.results[i][0].transcript;
          if (e.results[i].isFinal) finalText.current += t + " ";
          else interim += t;
        }
        setTranscript((finalText.current + interim).trim());
      };
      // long memos: Chrome ends recognition on silence — restart until we stop on purpose
      r.onend = () => {
        if (!stopped.current) {
          try {
            r.start();
          } catch {
            /* ignore */
          }
        }
      };
      r.onerror = () => {};
      try {
        r.start();
      } catch {
        /* ignore */
      }
      rec.current = r;
    }

    setPhase("recording");
    timer.current = setInterval(() => setSeconds((s) => s + 1), 1000);
  }, [onClose]);

  const stop = useCallback(async () => {
    stopped.current = true;
    if (timer.current) clearInterval(timer.current);
    setPhase("saving");
    setStatus("Finishing recording…");

    try {
      rec.current?.stop?.();
    } catch {
      /* ignore */
    }

    const mr = recorder.current;
    const blob: Blob = await new Promise((resolve) => {
      if (!mr || mr.state === "inactive") return resolve(new Blob(chunks.current));
      mr.onstop = () => resolve(new Blob(chunks.current, { type: mr.mimeType }));
      mr.stop();
    });
    recorder.current?.stream.getTracks().forEach((t) => t.stop());

    // give the recogniser a beat to flush its last final result
    await new Promise((r) => setTimeout(r, 400));
    const raw = finalText.current.trim() || transcript.trim();

    const { data: u } = await supabase.auth.getUser();
    const uid = u.user?.id;
    if (!uid) {
      toast("Not signed in", "error");
      cleanup();
      onClose();
      return;
    }

    // upload the audio
    setStatus("Saving audio…");
    const ext = blob.type.includes("mp4") ? "m4a" : "webm";
    const path = `${uid}/${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from("voice-memos")
      .upload(path, blob, { contentType: blob.type || "audio/webm" });
    if (upErr) toast(`Audio not saved: ${upErr.message}`, "error");

    // polish the transcript
    let title = "Voice memo";
    let markdown = raw;
    let tasks: { title: string; due_date?: string | null }[] = [];
    let warning: string | undefined;

    if (raw) {
      setStatus("Cleaning up the transcript…");
      try {
        const res = await fetch("/api/ai/note", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            transcript: raw,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          }),
        });
        const j = await res.json();
        title = j.title ?? title;
        markdown = j.markdown ?? raw;
        tasks = j.tasks ?? [];
        warning = j.warning;
      } catch {
        /* keep the raw transcript */
      }
    } else {
      markdown = "_No speech was picked up — the audio is attached below._";
      warning =
        "Couldn't transcribe (this browser may not support speech recognition), but the recording is saved.";
    }

    setStatus("Creating note…");
    const { data: note, error } = await supabase
      .from("notes")
      .insert({
        title,
        body: markdown,
        transcript: raw || null,
        audio_path: upErr ? null : path,
        duration_seconds: seconds,
      })
      .select("id")
      .single();

    if (error || !note) {
      toast(error?.message ?? "Couldn't save the note", "error");
      cleanup();
      onClose();
      return;
    }

    // create any action items it heard
    if (tasks.length) {
      const rows = tasks
        .filter((t) => t.title?.trim())
        .map((t) => ({ title: t.title.trim(), due_date: t.due_date ?? null }));
      if (rows.length) {
        const { error: tErr } = await supabase.from("tasks").insert(rows);
        if (!tErr) {
          setMadeTasks(rows.map((r) => r.title));
          window.dispatchEvent(new CustomEvent("cadence:tasks-changed"));
        }
      }
    }

    if (warning) toast(warning, "error");
    cleanup();
    setPhase("done");
    setTimeout(() => {
      onCreated(note.id as string);
      setPhase("idle");
    }, madeTasks.length ? 1600 : 700);
  }, [supabase, transcript, seconds, cleanup, onClose, onCreated, madeTasks.length]);

  useEffect(() => {
    if (open && phase === "idle") start();
    if (!open) cleanup();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => () => cleanup(), [cleanup]);

  if (!open) return null;

  const cancel = () => {
    stopped.current = true;
    cleanup();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/90 backdrop-blur-sm">
      <div className="flex items-center justify-between px-5 py-4">
        <span className="text-sm font-medium text-white/70">Voice memo</span>
        {phase === "recording" && (
          <button onClick={cancel} className="rounded-full p-2 text-white/60 active:bg-white/10">
            <X className="h-5 w-5" />
          </button>
        )}
      </div>

      <div className="flex flex-1 flex-col items-center justify-center px-6 pb-10">
        {phase === "recording" && (
          <>
            <div className="flex items-center gap-2 text-white/60">
              <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-danger" />
              <span className="text-lg tabular-nums">{fmt(seconds)}</span>
            </div>
            <p className="mt-6 max-h-64 w-full max-w-lg overflow-y-auto text-center text-lg leading-relaxed text-white">
              {transcript || <span className="text-white/40">Listening…</span>}
            </p>
          </>
        )}

        {phase === "saving" && (
          <>
            <Loader2 className="h-10 w-10 animate-spin text-accent" />
            <p className="mt-4 text-sm text-white/70">{status}</p>
          </>
        )}

        {phase === "done" && (
          <>
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-success/20">
              <Check className="h-8 w-8 text-success" />
            </div>
            <p className="mt-4 text-sm text-white/80">Note saved</p>
            {madeTasks.length > 0 && (
              <div className="mt-3 max-w-sm text-center">
                <p className="flex items-center justify-center gap-1.5 text-xs text-accentSoft">
                  <Sparkles className="h-3.5 w-3.5" />
                  {madeTasks.length} task{madeTasks.length > 1 ? "s" : ""} created
                </p>
                <p className="mt-1 text-xs text-white/50">{madeTasks.join(" · ")}</p>
              </div>
            )}
          </>
        )}
      </div>

      {phase === "recording" && (
        <div className="flex flex-col items-center pb-14">
          <button
            onClick={stop}
            aria-label="Stop recording"
            className={clsx(
              "flex h-20 w-20 items-center justify-center rounded-full bg-danger text-white shadow-lg transition active:scale-95"
            )}
          >
            <Square className="h-7 w-7 fill-current" />
          </button>
          <p className="mt-3 text-xs text-white/50">Tap to stop &amp; save</p>
        </div>
      )}
    </div>
  );
}
