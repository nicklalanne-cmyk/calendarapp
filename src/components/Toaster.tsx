"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, AlertTriangle, X, Undo2 } from "lucide-react";
import { runToastAction } from "@/lib/toast";
import clsx from "clsx";

type Item = {
  id: number;
  message: string;
  kind: "success" | "error";
  actionLabel: string | null;
};

export default function Toaster() {
  const [items, setItems] = useState<Item[]>([]);

  useEffect(() => {
    const onToast = (e: Event) => {
      const d = (e as CustomEvent).detail as Item & { duration: number };
      setItems((cur) => [
        ...cur,
        { id: d.id, message: d.message, kind: d.kind, actionLabel: d.actionLabel },
      ]);
      setTimeout(
        () => setItems((cur) => cur.filter((i) => i.id !== d.id)),
        d.duration
      );
    };
    window.addEventListener("cadence:toast", onToast);
    return () => window.removeEventListener("cadence:toast", onToast);
  }, []);

  if (items.length === 0) return null;

  return (
    <div className="pointer-events-none fixed inset-x-3 bottom-24 z-[60] flex flex-col gap-2 md:inset-x-auto md:right-4 md:bottom-4">
      {items.map((i) => (
        <div
          key={i.id}
          className={clsx(
            "pointer-events-auto flex items-center gap-2 rounded-xl border px-3 py-2.5 text-sm shadow-lg md:max-w-sm",
            i.kind === "error"
              ? "border-danger/40 bg-surface2 text-danger"
              : "border-border bg-surface2 text-txt2"
          )}
        >
          {i.kind === "error" ? (
            <AlertTriangle className="h-4 w-4 shrink-0" />
          ) : (
            <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
          )}
          <span className="min-w-0 flex-1">{i.message}</span>

          {i.actionLabel && (
            <button
              onClick={() => {
                runToastAction(i.id);
                setItems((cur) => cur.filter((x) => x.id !== i.id));
              }}
              className="flex shrink-0 items-center gap-1 rounded-lg bg-accent px-2.5 py-1.5 text-xs font-medium text-white active:opacity-80"
            >
              <Undo2 className="h-3.5 w-3.5" />
              {i.actionLabel}
            </button>
          )}

          <button
            onClick={() => setItems((cur) => cur.filter((x) => x.id !== i.id))}
            className="shrink-0 rounded p-1 text-txt3 hover:text-txt"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
