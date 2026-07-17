"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { X, Lightbulb, Bug, Send, Loader2, CheckCircle2, Clock, Paperclip } from "lucide-react";
import clsx from "clsx";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/lib/toast";

type Kind = "feature" | "bug";

type Item = {
  id: string;
  kind: Kind;
  body: string;
  status: string;
  created_at: string;
  image_paths: string[] | null;
};

// One shared signed-URL cache for feedback photos, same pattern as
// NotebookEditor's imageUrlCache — thumbnails get requested repeatedly as
// "your reports" re-renders, and signed URLs are valid for an hour anyway.
const imageUrlCache = new Map<string, string>();

const BULLET = "• ";

/**
 * Bullets are INSERTED on Enter and then left alone.
 *
 * The first version rewrote the whole textarea on every keystroke to force a
 * "• " onto each line — which meant deleting a bullet instantly re-added it and
 * you physically could not remove a line. Never fight the user's cursor.
 */
function stripBullets(v: string) {
  return v
    .split("\n")
    .map((l) => l.replace(/^[•\-*]\s*/, "").trim())
    .filter(Boolean)
    .join("\n");
}

export default function FeedbackOverlay({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const supabase = createClient();
  const [kind, setKind] = useState<Kind>("feature");
  const [text, setText] = useState(BULLET);
  const [busy, setBusy] = useState(false);
  const [mine, setMine] = useState<Item[]>([]);
  const [attachments, setAttachments] = useState<{ file: File; previewUrl: string }[]>([]);
  const ta = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadMine = useCallback(async () => {
    const { data } = await supabase
      .from("feedback")
      .select("id,kind,body,status,created_at,image_paths")
      .order("created_at", { ascending: false })
      .limit(30);
    setMine((data as Item[]) ?? []);
  }, [supabase]);

  const addAttachments = (files: File[]) => {
    const images = files.filter((f) => f.type.startsWith("image/"));
    if (images.length === 0) return;
    setAttachments((cur) => [...cur, ...images.map((file) => ({ file, previewUrl: URL.createObjectURL(file) }))]);
  };
  const removeAttachment = (previewUrl: string) => {
    setAttachments((cur) => {
      const found = cur.find((a) => a.previewUrl === previewUrl);
      if (found) URL.revokeObjectURL(found.previewUrl);
      return cur.filter((a) => a.previewUrl !== previewUrl);
    });
  };

  // Paste a screenshot/copied image straight into the report — same
  // clipboardData.items scan NotebookCanvas uses for pasting images onto a
  // page, just landing in the attachments tray instead of on a canvas.
  useEffect(() => {
    if (!open) return;
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const files: File[] = [];
      for (const item of Array.from(items)) {
        if (item.type.startsWith("image/")) {
          const f = item.getAsFile();
          if (f) files.push(f);
        }
      }
      if (files.length) {
        e.preventDefault();
        addAttachments(files);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    loadMine();
    setTimeout(() => ta.current?.focus(), 80);
  }, [open, loadMine]);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && open && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [open, onClose]);

  const submit = async () => {
    const body = stripBullets(text);
    if (!body) return;
    setBusy(true);

    const { data: u } = await supabase.auth.getUser();
    const uid = u.user?.id;

    // Upload attachments (if any) to the private feedback-images bucket,
    // path-prefixed by uid the same way notebook-images is, then store just
    // the storage paths on the row — mirrors NotebookEditor's insertImage.
    const image_paths: string[] = [];
    if (uid) {
      for (const a of attachments) {
        const path = `${uid}/${Date.now()}-${a.file.name}`;
        const { error: upErr } = await supabase.storage
          .from("feedback-images")
          .upload(path, a.file, { contentType: a.file.type || "image/png" });
        if (upErr) {
          setBusy(false);
          return toast(upErr.message, "error");
        }
        image_paths.push(path);
      }
    }

    const { error } = await supabase.from("feedback").insert({
      kind,
      body,
      user_email: u.user?.email ?? null,
      image_paths,
    });

    setBusy(false);
    if (error) return toast(error.message, "error");

    setText(BULLET);
    attachments.forEach((a) => URL.revokeObjectURL(a.previewUrl));
    setAttachments([]);
    toast(kind === "bug" ? "Bug reported — thank you" : "Feature request sent — thank you");
    window.dispatchEvent(new CustomEvent("cadence:feedback-changed"));
    loadMine();
  };

  if (!open) return null;

  const openItems = mine.filter((i) => i.status === "open");

  return (
    <div
      className="fixed inset-0 z-[85] flex items-end md:items-center md:justify-center"
      style={{ height: "var(--app-height, 100dvh)" }}
    >
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      <div className="relative flex max-h-[85%] w-full flex-col rounded-t-2xl border-t border-border bg-surface md:max-h-[85vh] md:max-w-md md:rounded-2xl md:border">
        <div className="flex items-center gap-2 border-b border-border p-3">
          <h2 className="text-sm font-semibold">Feature or bug</h2>
          <button
            onClick={onClose}
            className="ml-auto flex h-9 w-9 items-center justify-center rounded-lg text-txt3 active:bg-surface2"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <div className="mb-3 flex gap-0.5 rounded-xl bg-surface2 p-0.5">
            {(
              [
                ["feature", "Feature", Lightbulb],
                ["bug", "Bug", Bug],
              ] as const
            ).map(([id, label, Icon]) => (
              <button
                key={id}
                onClick={() => setKind(id)}
                className={clsx(
                  "flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-sm transition",
                  kind === id
                    ? id === "bug"
                      ? "bg-surface text-danger shadow-sm"
                      : "bg-surface text-accent shadow-sm"
                    : "text-txt3"
                )}
              >
                <Icon className="h-4 w-4" />
                {label}
              </button>
            ))}
          </div>

          <textarea
            ref={ta}
            value={text}
            rows={5}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                submit();
                return;
              }

              const el = e.currentTarget;
              const { selectionStart: a, selectionEnd: b, value } = el;

              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                const lineStart = value.lastIndexOf("\n", a - 1) + 1;
                const line = value.slice(lineStart, a);

                // Enter on an empty bullet ends the list, rather than making
                // another empty one you'd then have to delete.
                if (line.trim() === BULLET.trim()) {
                  const next = value.slice(0, lineStart) + value.slice(b);
                  setText(next);
                  requestAnimationFrame(() => el.setSelectionRange(lineStart, lineStart));
                  return;
                }

                const next = value.slice(0, a) + "\n" + BULLET + value.slice(b);
                setText(next);
                const caret = a + 1 + BULLET.length;
                requestAnimationFrame(() => el.setSelectionRange(caret, caret));
                return;
              }

              // Backspace sitting just after a "• " removes the whole marker in
              // one press, instead of leaving a stray bullet character behind.
              if (e.key === "Backspace" && a === b) {
                const lineStart = value.lastIndexOf("\n", a - 1) + 1;
                if (a === lineStart + BULLET.length && value.slice(lineStart, a) === BULLET) {
                  e.preventDefault();
                  const cut = lineStart === 0 ? 0 : lineStart - 1; // also eat the newline
                  const next = value.slice(0, cut) + value.slice(a);
                  setText(next);
                  requestAnimationFrame(() => el.setSelectionRange(cut, cut));
                }
              }
            }}
            placeholder={
              kind === "bug"
                ? "What broke? What were you doing?"
                : "What would make this better?"
            }
            className="w-full resize-y rounded-xl border border-border bg-bg px-3 py-2.5 text-[15px] leading-relaxed outline-none focus:border-accent md:text-sm"
          />
          <p className="mt-1 px-1 text-[11px] text-txt3">
            Enter starts a new bullet · empty bullet + Enter ends the list · ⌘/Ctrl+Enter sends · paste a screenshot to attach it
          </p>

          {attachments.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {attachments.map((a) => (
                <div key={a.previewUrl} className="group relative h-16 w-16 overflow-hidden rounded-lg border border-border">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={a.previewUrl} alt="" className="h-full w-full object-cover" />
                  <button
                    onClick={() => removeAttachment(a.previewUrl)}
                    className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files) addAttachments(Array.from(e.target.files));
              e.target.value = "";
            }}
          />

          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={() => fileRef.current?.click()}
              className="flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-xs text-txt2 hover:bg-surface2"
            >
              <Paperclip className="h-3.5 w-3.5" />
              Attach photo
            </button>
            <button
              onClick={submit}
              disabled={busy || !stripBullets(text)}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-accent py-3 text-sm font-medium text-white transition active:opacity-80 disabled:opacity-40"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Send
            </button>
          </div>

          {mine.length > 0 && (
            <div className="mt-5">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-txt3">
                Your reports
                {openItems.length > 0 && (
                  <span className="ml-1 text-txt3">· {openItems.length} open</span>
                )}
              </p>

              <div className="space-y-2">
                {mine.map((i) => (
                  <div
                    key={i.id}
                    className={clsx(
                      "rounded-xl border p-2.5",
                      i.status === "cleared"
                        ? "border-border bg-surface2/40 opacity-60"
                        : "border-border bg-bg"
                    )}
                  >
                    <div className="mb-1 flex items-center gap-1.5 text-[11px]">
                      {i.kind === "bug" ? (
                        <Bug className="h-3 w-3 text-danger" />
                      ) : (
                        <Lightbulb className="h-3 w-3 text-accent" />
                      )}
                      <span className="text-txt3">
                        {new Date(i.created_at).toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                        })}
                      </span>
                      <span
                        className={clsx(
                          "ml-auto flex items-center gap-1",
                          i.status === "cleared" ? "text-success" : "text-txt3"
                        )}
                      >
                        {i.status === "cleared" ? (
                          <>
                            <CheckCircle2 className="h-3 w-3" /> Done
                          </>
                        ) : (
                          <>
                            <Clock className="h-3 w-3" /> Open
                          </>
                        )}
                      </span>
                    </div>
                    <ul className="space-y-0.5">
                      {i.body.split("\n").map((line, n) => (
                        <li
                          key={n}
                          className={clsx(
                            "flex gap-1.5 text-xs",
                            i.status === "cleared" ? "text-txt3 line-through" : "text-txt2"
                          )}
                        >
                          <span className="text-txt3">•</span>
                          <span className="min-w-0 flex-1">{line}</span>
                        </li>
                      ))}
                    </ul>
                    {i.image_paths && i.image_paths.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {i.image_paths.map((p) => (
                          <FeedbackThumb key={p} path={p} />
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** A single attached-photo thumbnail, resolved from its storage path to a
 * signed URL on mount — same cached-signed-URL approach as NotebookEditor's
 * resolveImageUrl, since feedback-images is a private bucket. */
function FeedbackThumb({ path }: { path: string }) {
  const [url, setUrl] = useState<string | null>(imageUrlCache.get(path) ?? null);

  useEffect(() => {
    if (url) return;
    let cancelled = false;
    const supabase = createClient();
    supabase.storage
      .from("feedback-images")
      .createSignedUrl(path, 3600)
      .then(({ data }) => {
        if (cancelled || !data?.signedUrl) return;
        imageUrlCache.set(path, data.signedUrl);
        setUrl(data.signedUrl);
      });
    return () => {
      cancelled = true;
    };
  }, [path, url]);

  if (!url) return <div className="h-14 w-14 animate-pulse rounded-lg bg-surface2" />;
  return (
    <a href={url} target="_blank" rel="noreferrer" className="block h-14 w-14 overflow-hidden rounded-lg border border-border">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt="" className="h-full w-full object-cover" />
    </a>
  );
}
