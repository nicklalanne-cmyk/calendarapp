"use client";

import { X, Trash2 } from "lucide-react";
import PropertyCell from "@/components/pages/PropertyCell";
import type { PageProperty, PageRecord } from "@/lib/pages";

/** Full-record editor — the only sane way to edit a wide table on a phone. */
export default function RecordSheet({
  record,
  props,
  onClose,
  onChange,
  onDelete,
  dateMenuFor,
}: {
  record: PageRecord;
  props: PageProperty[];
  onClose: () => void;
  onChange: (patch: { title?: string; props?: Record<string, unknown> }) => void;
  onDelete: () => void;
  dateMenuFor?: (r: PageRecord, p: PageProperty) => React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center md:justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative max-h-[85vh] w-full overflow-y-auto rounded-t-2xl border-t border-border bg-surface p-4 pb-8 md:max-w-md md:rounded-2xl md:border md:pb-4">
        <div className="mb-4 flex items-start gap-2">
          <input
            value={record.title}
            onChange={(e) => onChange({ title: e.target.value })}
            placeholder="Untitled"
            className="min-w-0 flex-1 bg-transparent text-xl font-semibold outline-none placeholder:text-txt3"
          />
          <button
            onClick={onClose}
            className="-mr-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-txt3 active:bg-surface2"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-3">
          {props.map((p) => (
            <div key={p.id} className="grid grid-cols-[110px_1fr] items-center gap-2">
              <span className="truncate text-xs text-txt3">{p.name}</span>
              <PropertyCell
                prop={p}
                value={record.props[p.id]}
                dateMenu={dateMenuFor?.(record, p)}
                onChange={(v) => onChange({ props: { ...record.props, [p.id]: v } })}
              />
            </div>
          ))}
          {props.length === 0 && (
            <p className="text-xs text-txt3">No properties yet — add one from the table header.</p>
          )}
        </div>

        <button
          onClick={onDelete}
          className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl border border-border py-3 text-sm text-txt3 active:bg-surface2 hover:text-danger"
        >
          <Trash2 className="h-4 w-4" /> Delete record
        </button>
      </div>
    </div>
  );
}
