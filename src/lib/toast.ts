export type ToastKind = "success" | "error";

export type ToastOpts = {
  kind?: ToastKind;
  /** Renders a button on the toast (e.g. "Undo"). */
  action?: { label: string; run: () => void | Promise<void> };
  /** ms before it auto-dismisses. Undo toasts get longer. */
  duration?: number;
};

const listeners = new Map<number, ToastOpts["action"]>();
let seq = 0;

export function toast(message: string, kindOrOpts: ToastKind | ToastOpts = "success") {
  if (typeof window === "undefined") return;
  const opts: ToastOpts =
    typeof kindOrOpts === "string" ? { kind: kindOrOpts } : kindOrOpts;

  const id = ++seq;
  if (opts.action) listeners.set(id, opts.action);

  window.dispatchEvent(
    new CustomEvent("cadence:toast", {
      detail: {
        id,
        message,
        kind: opts.kind ?? "success",
        actionLabel: opts.action?.label ?? null,
        duration: opts.duration ?? (opts.action ? 9000 : 5000),
      },
    })
  );
}

/** Called by the Toaster when the action button is pressed. */
export function runToastAction(id: number) {
  const a = listeners.get(id);
  listeners.delete(id);
  a?.run();
}
