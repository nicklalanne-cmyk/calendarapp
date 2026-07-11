"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Trash2, Plus, GripVertical } from "lucide-react";
import clsx from "clsx";
import { CHOICE_COLORS, PROP_TYPES, uid, type PageProperty, type PropType } from "@/lib/pages";

export default function PropertyMenu({
  prop,
  onSave,
  onDelete,
  onGroupBy,
  isGroupBy,
}: {
  prop: PageProperty;
  onSave: (patch: Partial<PageProperty>) => void;
  onDelete: () => void;
  onGroupBy: () => void;
  isGroupBy: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(prop.name);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => setName(prop.name), [prop.name]);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  const choices = prop.options.choices ?? [];

  const addChoice = () => {
    const c = {
      id: uid(),
      label: "New option",
      color: CHOICE_COLORS[choices.length % CHOICE_COLORS.length],
    };
    onSave({ options: { ...prop.options, choices: [...choices, c] } });
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1 rounded px-1 py-1 text-left text-[11px] font-semibold uppercase tracking-wide text-txt3 hover:bg-surface2"
      >
        <span className="truncate">{prop.name}</span>
        <ChevronDown className="ml-auto h-3 w-3 shrink-0 opacity-0 group-hover/col:opacity-100" />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-40 mt-1 w-64 rounded-xl border border-border bg-surface p-2 shadow-xl">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => name.trim() && name !== prop.name && onSave({ name: name.trim() })}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            className="mb-2 w-full rounded-lg border border-border bg-bg px-2 py-1.5 text-sm outline-none focus:border-accent"
          />

          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-txt3">
            Type
          </label>
          <select
            value={prop.type}
            onChange={(e) => onSave({ type: e.target.value as PropType })}
            className="mb-2 w-full rounded-lg border border-border bg-bg px-2 py-1.5 text-sm outline-none focus:border-accent"
          >
            {PROP_TYPES.map((t) => (
              <option key={t.type} value={t.type}>
                {t.label}
              </option>
            ))}
          </select>

          {prop.type === "select" && (
            <div className="mb-2">
              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-txt3">
                Options
              </label>
              <div className="space-y-1">
                {choices.map((c, i) => (
                  <div key={c.id} className="flex items-center gap-1">
                    <button
                      onClick={() => {
                        const next = [...choices];
                        const ci = CHOICE_COLORS.indexOf(c.color);
                        next[i] = {
                          ...c,
                          color: CHOICE_COLORS[(ci + 1) % CHOICE_COLORS.length],
                        };
                        onSave({ options: { ...prop.options, choices: next } });
                      }}
                      className="h-4 w-4 shrink-0 rounded"
                      style={{ background: c.color }}
                      title="Change colour"
                    />
                    <input
                      defaultValue={c.label}
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        if (!v || v === c.label) return;
                        const next = [...choices];
                        next[i] = { ...c, label: v };
                        onSave({ options: { ...prop.options, choices: next } });
                      }}
                      className="min-w-0 flex-1 rounded border border-border bg-bg px-1.5 py-1 text-xs outline-none focus:border-accent"
                    />
                    <button
                      onClick={() =>
                        onSave({
                          options: {
                            ...prop.options,
                            choices: choices.filter((x) => x.id !== c.id),
                          },
                        })
                      }
                      className="shrink-0 rounded p-1 text-txt3 hover:text-danger"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
              <button
                onClick={addChoice}
                className="mt-1 flex items-center gap-1 rounded px-1 py-1 text-xs text-txt3 hover:text-txt"
              >
                <Plus className="h-3 w-3" /> Add option
              </button>
            </div>
          )}

          {prop.type === "select" && (
            <button
              onClick={() => {
                onGroupBy();
                setOpen(false);
              }}
              className={clsx(
                "mb-1 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs",
                isGroupBy ? "bg-accent/10 text-accent" : "text-txt2 hover:bg-surface2"
              )}
            >
              <GripVertical className="h-3.5 w-3.5" />
              {isGroupBy ? "Grouping by this" : "Group by this"}
            </button>
          )}

          <button
            onClick={() => {
              onDelete();
              setOpen(false);
            }}
            className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-txt3 hover:bg-surface2 hover:text-danger"
          >
            <Trash2 className="h-3.5 w-3.5" /> Delete property
          </button>
        </div>
      )}
    </div>
  );
}
