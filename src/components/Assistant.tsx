"use client";

import { useEffect, useRef, useState } from "react";
import { Sparkles, X, ArrowUp, Loader2, ImagePlus } from "lucide-react";
import clsx from "clsx";

type Turn = { role: "user" | "assistant"; text: string; images?: string[] };

type ImagePart = { dataUrl: string; base64: string; mediaType: string };

const MAX_IMAGES = 3;
// Photos straight from a phone camera can be several MB / 4000px+ — draw them
// down to a max dimension and re-encode as JPEG before sending, both to stay
// well under the API route's request body limit and to keep token cost sane.
const MAX_DIM = 1440;

async function fileToImagePart(file: File): Promise<ImagePart | null> {
  if (!file.type.startsWith("image/")) return null;
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("Couldn't read that image."));
    el.src = dataUrl;
  });
  let { width, height } = img;
  if (width > MAX_DIM || height > MAX_DIM) {
    const scale = MAX_DIM / Math.max(width, height);
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, width, height);
  const outDataUrl = canvas.toDataURL("image/jpeg", 0.82);
  const base64 = outDataUrl.split(",")[1] ?? "";
  if (!base64) return null;
  return { dataUrl: outDataUrl, base64, mediaType: "image/jpeg" };
}

const SUGGESTIONS = [
  "What's on my plate today?",
  "Add a task to review the listing deck, due Friday, P1",
  "Block 9–10am tomorrow for deep work",
  "Remind me to send invoices the first Thursday of every month",
];

export default function Assistant({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [raw, setRaw] = useState<unknown[]>([]); // full API message history (incl. tool blocks)
  const [input, setInput] = useState("");
  const [images, setImages] = useState<ImagePart[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 60);
  }, [open]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [turns, busy]);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && open && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [open, onClose]);

  const addFiles = async (files: FileList | File[]) => {
    try {
      const parts = await Promise.all(Array.from(files).map(fileToImagePart));
      const valid = parts.filter((p): p is ImagePart => Boolean(p));
      if (valid.length) setImages((cur) => [...cur, ...valid].slice(0, MAX_IMAGES));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const onPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.clipboardData.items)
      .filter((it) => it.kind === "file" && it.type.startsWith("image/"))
      .map((it) => it.getAsFile())
      .filter((f): f is File => Boolean(f));
    if (files.length) {
      e.preventDefault();
      addFiles(files);
    }
  };

  const send = async (text: string) => {
    const q = text.trim();
    if ((!q && images.length === 0) || busy) return;
    const imgsToSend = images;
    setInput("");
    setImages([]);
    setError(null);
    setTurns((t) => [...t, { role: "user", text: q, images: imgsToSend.map((i) => i.dataUrl) }]);
    setBusy(true);

    const content =
      imgsToSend.length > 0
        ? [
            ...imgsToSend.map((img) => ({
              type: "image" as const,
              source: { type: "base64" as const, media_type: img.mediaType, data: img.base64 },
            })),
            { type: "text" as const, text: q || "What do you see in this photo?" },
          ]
        : q;

    const history = [...raw, { role: "user", content }];

    try {
      const res = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: history,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
      });
      const j = await res.json();

      if (!res.ok) {
        setError(j.error ?? "Something went wrong.");
        setBusy(false);
        return;
      }

      setTurns((t) => [...t, { role: "assistant", text: j.reply }]);
      setRaw(j.messages ?? history);

      // tell the rest of the app to refetch
      if (j.mutated?.tasks || j.mutated?.events || j.mutated?.automations) {
        window.dispatchEvent(
          new CustomEvent("cadence:ai-mutated", { detail: j.mutated })
        );
      }
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  };

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30 md:hidden" onClick={onClose} />
      <aside className="fixed right-0 top-0 z-50 flex h-[100dvh] w-full flex-col border-l border-border bg-surface shadow-2xl md:w-[400px]">
        <header className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Sparkles className="h-4 w-4 text-accent" />
          <span className="text-sm font-semibold">Ask Cadence</span>
          <span className="ml-auto text-[10px] text-txt3">⌘J</span>
          <button
            onClick={onClose}
            className="rounded p-1 text-txt3 hover:bg-surface2 hover:text-txt"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div ref={scroller} className="flex-1 space-y-3 overflow-y-auto p-4">
          {turns.length === 0 && (
            <div className="pt-4">
              <p className="mb-3 text-xs text-txt3">
                I can create, change and delete your tasks and calendar events. Try:
              </p>
              <div className="space-y-1.5">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    className="w-full rounded-lg border border-border px-3 py-2 text-left text-xs text-txt2 transition hover:border-accent hover:bg-surface2 hover:text-txt"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {turns.map((t, i) => (
            <div
              key={i}
              className={clsx("flex", t.role === "user" ? "justify-end" : "justify-start")}
            >
              <div
                className={clsx(
                  "max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm",
                  t.role === "user"
                    ? "rounded-br-sm bg-accent text-white"
                    : "rounded-bl-sm bg-surface2 text-txt"
                )}
              >
                {t.images && t.images.length > 0 && (
                  <div className="mb-1.5 flex flex-wrap gap-1.5">
                    {t.images.map((src, idx) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        key={idx}
                        src={src}
                        alt=""
                        className="h-20 w-20 rounded-lg object-cover"
                      />
                    ))}
                  </div>
                )}
                {t.text}
              </div>
            </div>
          ))}

          {busy && (
            <div className="flex items-center gap-2 text-xs text-txt3">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Working…
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
              {error}
            </div>
          )}
        </div>

        <div className="border-t border-border p-3">
          {images.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {images.map((img, idx) => (
                <div key={idx} className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={img.dataUrl}
                    alt=""
                    className="h-14 w-14 rounded-lg border border-border object-cover"
                  />
                  <button
                    onClick={() => setImages((cur) => cur.filter((_, i) => i !== idx))}
                    className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-surface3 text-txt2 shadow"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.length) addFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <div className="flex items-end gap-2 rounded-xl border border-border bg-bg px-3 py-2 focus-within:border-accent">
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={images.length >= MAX_IMAGES}
              title="Attach a photo"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-txt3 transition hover:bg-surface2 hover:text-accent disabled:opacity-30"
            >
              <ImagePlus className="h-4 w-4" />
            </button>
            <textarea
              ref={inputRef}
              value={input}
              rows={1}
              onChange={(e) => {
                setInput(e.target.value);
                e.target.style.height = "auto";
                e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send(input);
                }
              }}
              onPaste={onPaste}
              placeholder="Ask, or tell me what to change… (paste or attach a photo)"
              className="max-h-[120px] flex-1 resize-none bg-transparent text-sm outline-none placeholder:text-txt3"
            />
            <button
              onClick={() => send(input)}
              disabled={(!input.trim() && images.length === 0) || busy}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent text-white transition disabled:opacity-30"
            >
              <ArrowUp className="h-4 w-4" />
            </button>
          </div>
          <p className="mt-1.5 px-1 text-[10px] text-txt3">
            It can delete things. Deletions are permanent.
          </p>
        </div>
      </aside>
    </>
  );
}
