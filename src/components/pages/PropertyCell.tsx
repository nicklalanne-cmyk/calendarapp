"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, X } from "lucide-react";
import clsx from "clsx";
import {
  choiceOf,
  formatValue,
  type PageProperty,
} from "@/lib/pages";

export default function PropertyCell({
  prop,
  value,
  onChange,
  compact,
  dateMenu,
}: {
  prop: PageProperty;
  value: unknown;
  onChange: (v: unknown) => void;
  compact?: boolean;
  /** Rendered next to a date value: turn it into a task/event. */
  dateMenu?: React.ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string>(value == null ? "" : String(value));
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number; width: number } | null>(null);

  useEffect(() => {
    setDraft(value == null ? "" : String(value));
  }, [value]);

  // The menu is rendered in a portal: a table cell lives inside overflow-x-auto,
  // which would otherwise clip an absolutely-positioned dropdown.
  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const place = () => {
      const r = btnRef.current!.getBoundingClientRect();
      const H = 260;
      const below = window.innerHeight - r.bottom;
      setMenuPos({
        top: below < H && r.top > below ? r.top - Math.min(H, r.top) - 4 : r.bottom + 4,
        left: Math.min(r.left, window.innerWidth - 190),
        width: Math.max(r.width, 170),
      });
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (
        ref.current?.contains(e.target as Node) ||
        (e.target as HTMLElement).closest?.("[data-cadence-menu]")
      )
        return;
      setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const commit = () => {
    setEditing(false);
    const raw = draft.trim();
    if (raw === "") return onChange(null);
    if (prop.type === "number" || prop.type === "currency") {
      const n = Number(raw.replace(/[^0-9.-]/g, ""));
      return onChange(isNaN(n) ? null : n);
    }
    onChange(raw);
  };

  // ---- checkbox
  if (prop.type === "checkbox") {
    return (
      <button
        onClick={() => onChange(!value)}
        className={clsx(
          "flex h-[18px] w-[18px] items-center justify-center rounded border transition",
          value ? "border-accent bg-accent text-white" : "border-txt3 hover:border-accent"
        )}
        aria-label={prop.name}
      >
        {Boolean(value) && <Check className="h-3 w-3" />}
      </button>
    );
  }

  // ---- select
  if (prop.type === "select") {
    const c = choiceOf(prop, value);
    const choices = prop.options.choices ?? [];
    return (
      <div ref={ref} className="relative">
        <button
          ref={btnRef}
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center gap-1 rounded px-1 py-1.5 text-left hover:bg-surface2"
        >
          {c ? (
            <span
              className="truncate rounded-md px-2 py-0.5 text-xs font-medium"
              style={{ background: `${c.color}26`, color: c.color }}
            >
              {c.label}
            </span>
          ) : (
            <span className="text-xs text-txt3">Empty</span>
          )}
          <ChevronDown className="ml-auto h-3 w-3 shrink-0 text-txt3" />
        </button>

        {open &&
          menuPos &&
          createPortal(
            <div
              data-cadence-menu
              style={{ position: "fixed", top: menuPos.top, left: menuPos.left, width: menuPos.width }}
              className="z-[70] max-h-[260px] overflow-y-auto rounded-lg border border-border bg-surface p-1 shadow-2xl"
            >
            <button
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-txt3 hover:bg-surface2"
            >
              <X className="h-3 w-3" /> Clear
            </button>
            {choices.map((ch) => (
              <button
                key={ch.id}
                onClick={() => {
                  onChange(ch.id);
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-surface2"
              >
                <span
                  className="truncate rounded-md px-2 py-0.5 text-xs font-medium"
                  style={{ background: `${ch.color}26`, color: ch.color }}
                >
                  {ch.label}
                </span>
                {value === ch.id && <Check className="ml-auto h-3 w-3 text-accent" />}
              </button>
            ))}
            {choices.length === 0 && (
              <p className="px-2 py-1.5 text-xs text-txt3">
                No options yet — add them in the column menu.
              </p>
            )}
            </div>,
            document.body
          )}
      </div>
    );
  }

  // ---- everything else: click to edit
  if (editing) {
    const inputType =
      prop.type === "date"
        ? "date"
        : prop.type === "number" || prop.type === "currency"
          ? "number"
          : prop.type === "email"
            ? "email"
            : prop.type === "url"
              ? "url"
              : prop.type === "phone"
                ? "tel"
                : "text";
    return (
      <input
        autoFocus
        type={inputType}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") {
            setDraft(value == null ? "" : String(value));
            setEditing(false);
          }
        }}
        className="w-full rounded border border-accent bg-bg px-1.5 py-1 text-sm outline-none"
      />
    );
  }

  const display = formatValue(value, prop);
  const isLink = prop.type === "email" || prop.type === "url" || prop.type === "phone";

  const face = (
    <button
      onClick={() => setEditing(true)}
      className={clsx(
        "min-w-0 flex-1 truncate rounded px-1.5 py-1 text-left text-sm hover:bg-surface2",
        !display && "text-txt3",
        compact && "text-xs"
      )}
    >
      {display ? (
        isLink ? (
          <span className="text-accentSoft underline decoration-transparent hover:decoration-inherit">
            {display}
          </span>
        ) : (
          display
        )
      ) : (
        "Empty"
      )}
    </button>
  );

  if (prop.type === "date" && dateMenu && display) {
    return (
      <div className="flex items-center gap-0.5">
        {face}
        {dateMenu}
      </div>
    );
  }

  return <div className="flex w-full">{face}</div>;
}
