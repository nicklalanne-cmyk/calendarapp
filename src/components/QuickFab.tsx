"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, X, CheckSquare, CalendarPlus, FileText, Mic, Loader2 } from "lucide-react";
import clsx from "clsx";

type SR = {
  start: () => void;
  stop: () => void;
  abort: () => void;
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: any) => void) | null;
  onerror: ((e: any) => void) | null;
  onend: (() => void) | null;
};

function getRecognition(): SR | null {
  if (typeof window === "undefined") return null;
  const Ctor =
    (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  if (!Ctor) return null;
  const r: SR = new Ctor();
  r.continuous = false;
  r.interimResults = true;
  r.lang = navigator.language || "en-US";
  return r;
}

export default function QuickFab({
  onNewTask,
  onNewEvent,
  onNewNote,
  onVoiceMemo,
}: {
  onNewTask: () => void;
  onNewEvent: () => void;
  onNewNote: () => void;
  onVoiceMemo: () => void;
}) {
  const [menu, setMenu] = useState(false);
  const [voice, setVoice] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [status, setStatus] = useState<"listening" | "thinking" | "done" | "error">("listening");
  const [reply, setReply] = useState("");

  const recRef = useRef<SR | null>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const held = useRef(false);
  const finalText = useRef("");

  const send = useCallback(async (text: string) => {
    const q = text.trim();
    if (!q) {
      setVoice(false);
      return;
    }
    setStatus("thinking");
    try {
      const res = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: q }],
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
      });
      const j = await res.json();
      if (!res.ok) {
        setStatus("error");
        setReply(j.error ?? "Something went wrong.");
        return;
      }
      setStatus("done");
      setReply(j.reply ?? "Done.");
      if (j.mutated?.tasks || j.mutated?.events || j.mutated?.automations) {
        window.dispatchEvent(new CustomEvent("cadence:ai-mutated", { detail: j.mutated }));
      }
      setTimeout(() => setVoice(false), 2200);
    } catch (e) {
      setStatus("error");
      setReply((e as Error).message);
    }
  }, []);

  const startVoice = useCallback(() => {
    const rec = getRecognition();
    if (!rec) {
      setVoice(true);
      setStatus("error");
      setReply("This browser can't do speech recognition. Use the ✨ assistant and type instead.");
      return;
    }
    finalText.current = "";
    setTranscript("");
    setReply("");
    setStatus("listening");
    setVoice(true);

    rec.onresult = (e: any) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const chunk = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText.current += chunk;
        else interim += chunk;
      }
      setTranscript((finalText.current + interim).trim());
    };
    rec.onerror = (e: any) => {
      setStatus("error");
      setReply(
        e?.error === "not-allowed"
          ? "Microphone permission was denied."
          : `Couldn't hear that (${e?.error ?? "error"}).`
      );
    };
    rec.onend = () => {
      const t = finalText.current.trim();
      if (t) send(t);
      else if (status === "listening") setVoice(false);
    };

    recRef.current = rec;
    try {
      rec.start();
    } catch {
      /* already started */
    }
  }, [send, status]);

  const stopVoice = useCallback(() => {
    recRef.current?.stop();
  }, []);

  const cancelVoice = () => {
    recRef.current?.abort();
    setVoice(false);
  };

  // press-and-hold detection
  const onDown = () => {
    held.current = false;
    holdTimer.current = setTimeout(() => {
      held.current = true;
      if (navigator.vibrate) navigator.vibrate(12);
      startVoice();
    }, 350);
  };
  const onUp = () => {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    if (held.current) {
      stopVoice(); // release to send
    } else {
      setMenu((v) => !v);
    }
    held.current = false;
  };
  const onLeave = () => {
    if (holdTimer.current) clearTimeout(holdTimer.current);
  };

  useEffect(() => {
    return () => {
      if (holdTimer.current) clearTimeout(holdTimer.current);
      recRef.current?.abort();
    };
  }, []);

  const pick = (fn: () => void) => {
    setMenu(false);
    fn();
  };

  return (
    <>
      {/* radial quick-create */}
      {menu && (
        <div className="fixed inset-0 z-40" onClick={() => setMenu(false)}>
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div className="absolute inset-x-0 bottom-[80px] flex items-end justify-center gap-4 pb-6">
            <RadialButton
              label="Event"
              icon={<CalendarPlus className="h-6 w-6" />}
              className="mb-1"
              onClick={() => pick(onNewEvent)}
            />
            <RadialButton
              label="Memo"
              icon={<Mic className="h-6 w-6" />}
              className="mb-8"
              accent="danger"
              onClick={() => pick(onVoiceMemo)}
            />
            <RadialButton
              label="Note"
              icon={<FileText className="h-6 w-6" />}
              className="mb-8"
              onClick={() => pick(onNewNote)}
            />
            <RadialButton
              label="Task"
              icon={<CheckSquare className="h-6 w-6" />}
              className="mb-1"
              onClick={() => pick(onNewTask)}
            />
          </div>
          <p className="absolute inset-x-0 bottom-[46px] text-center text-[11px] text-white/50">
            Hold <span className="font-semibold">+</span> to speak
          </p>
        </div>
      )}

      {/* voice overlay */}
      {voice && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/80 px-8 backdrop-blur-sm">
          <button
            onClick={cancelVoice}
            className="absolute right-5 top-5 rounded-full p-2 text-white/60 hover:bg-white/10"
          >
            <X className="h-5 w-5" />
          </button>

          <div
            className={clsx(
              "flex h-24 w-24 items-center justify-center rounded-full",
              status === "listening" ? "animate-pulse bg-accent" : "bg-surface3"
            )}
          >
            {status === "thinking" ? (
              <Loader2 className="h-9 w-9 animate-spin text-white" />
            ) : (
              <Mic className="h-9 w-9 text-white" />
            )}
          </div>

          <p className="mt-6 min-h-[3rem] max-w-sm text-center text-lg text-white">
            {transcript || (status === "listening" ? "Listening…" : "")}
          </p>

          {status === "listening" && (
            <p className="mt-1 text-xs text-white/50">Release to send</p>
          )}
          {(status === "done" || status === "error") && reply && (
            <p
              className={clsx(
                "mt-3 max-w-sm text-center text-sm",
                status === "error" ? "text-danger" : "text-white/70"
              )}
            >
              {reply}
            </p>
          )}
          {status === "listening" && (
            <button
              onClick={stopVoice}
              className="mt-8 rounded-full bg-white px-6 py-2 text-sm font-medium text-black"
            >
              Done
            </button>
          )}
        </div>
      )}

      {/* the FAB itself */}
      <button
        aria-label="Quick create — hold to speak"
        onPointerDown={onDown}
        onPointerUp={onUp}
        onPointerLeave={onLeave}
        onContextMenu={(e) => e.preventDefault()}
        className={clsx(
          "relative z-50 -mt-7 flex h-16 w-16 shrink-0 select-none items-center justify-center rounded-full bg-accent text-white shadow-lg shadow-accent/30 transition active:scale-95",
          menu && "rotate-45"
        )}
        style={{ touchAction: "none" }}
      >
        <Plus className="h-8 w-8" />
      </button>
    </>
  );
}

function RadialButton({
  label,
  icon,
  onClick,
  className,
  accent,
}: {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  className?: string;
  accent?: "danger";
}) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={clsx("flex flex-col items-center gap-1.5", className)}
    >
      <span
        className={clsx(
          "flex h-16 w-16 items-center justify-center rounded-full bg-surface2 shadow-lg",
          accent === "danger" ? "text-danger" : "text-accent"
        )}
      >
        {icon}
      </span>
      <span className="text-xs font-medium text-white/80">{label}</span>
    </button>
  );
}
