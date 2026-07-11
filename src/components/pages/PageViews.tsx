"use client";

import { useMemo, useState } from "react";
import { Plus, ChevronDown, ChevronRight, GripVertical } from "lucide-react";
import clsx from "clsx";
import PropertyCell from "@/components/pages/PropertyCell";
import PropertyMenu from "@/components/pages/PropertyMenu";
import {
  choiceOf,
  compareBy,
  formatValue,
  type Page,
  type PageProperty,
  type PageRecord,
} from "@/lib/pages";

export type ViewProps = {
  page: Page;
  props: PageProperty[];
  records: PageRecord[];
  onAddRecord: (seed?: Record<string, unknown>) => void;
  onPatchRecord: (id: string, patch: { title?: string; props?: Record<string, unknown> }) => void;
  onOpenRecord: (r: PageRecord) => void;
  onAddProperty: () => void;
  onSaveProperty: (id: string, patch: Partial<PageProperty>) => void;
  onDeleteProperty: (id: string) => void;
  onSetGroupBy: (id: string | null) => void;
};

/** Split records into groups by the group_by select property. */
function useGroups(page: Page, props: PageProperty[], records: PageRecord[]) {
  return useMemo(() => {
    const gp = props.find((p) => p.id === page.group_by && p.type === "select") ?? null;
    const sortProp = props.find((p) => p.id === page.sort_by) ?? null;
    const sorted = [...records].sort((a, b) => compareBy(a, b, sortProp, page.sort_dir));

    if (!gp) return { gp: null, groups: [{ key: "all", label: "", color: "", items: sorted }] };

    const choices = gp.options.choices ?? [];
    const groups = choices.map((c) => ({
      key: c.id,
      label: c.label,
      color: c.color,
      items: sorted.filter((r) => r.props[gp.id] === c.id),
    }));
    const ungrouped = sorted.filter((r) => !choiceOf(gp, r.props[gp.id]));
    if (ungrouped.length) {
      groups.push({ key: "__none", label: "No status", color: "#6E6E7A", items: ungrouped });
    }
    return { gp, groups };
  }, [page.group_by, page.sort_by, page.sort_dir, props, records]);
}

/* ------------------------------------------------------------------ TABLE */

export function TableView(v: ViewProps) {
  const { gp, groups } = useGroups(v.page, v.props, v.records);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const toggle = (k: string) =>
    setCollapsed((c) => {
      const n = new Set(c);
      n.has(k) ? n.delete(k) : n.add(k);
      return n;
    });

  return (
    <div className="min-w-0 overflow-x-auto">
      <div className="min-w-fit px-4 pb-24 md:px-8">
        {groups.map((g) => {
          const isOpen = !collapsed.has(g.key);
          return (
            <div key={g.key} className="mb-6">
              {gp && (
                <button
                  onClick={() => toggle(g.key)}
                  className="mb-1 flex items-center gap-2 py-1"
                >
                  {isOpen ? (
                    <ChevronDown className="h-4 w-4 text-txt3" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-txt3" />
                  )}
                  <span
                    className="rounded-md px-2 py-0.5 text-xs font-semibold"
                    style={{ background: `${g.color}26`, color: g.color }}
                  >
                    {g.label}
                  </span>
                  <span className="text-xs text-txt3">{g.items.length}</span>
                </button>
              )}

              {isOpen && (
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="w-[240px] min-w-[200px] px-1 pb-1 text-left md:w-[280px]">
                        <span className="px-1 text-[11px] font-semibold uppercase tracking-wide text-txt3">
                          Name
                        </span>
                      </th>
                      {v.props.map((p) => (
                        <th
                          key={p.id}
                          className="group/col w-[150px] min-w-[130px] px-1 pb-1 text-left"
                        >
                          <PropertyMenu
                            prop={p}
                            isGroupBy={v.page.group_by === p.id}
                            onSave={(patch) => v.onSaveProperty(p.id, patch)}
                            onDelete={() => v.onDeleteProperty(p.id)}
                            onGroupBy={() =>
                              v.onSetGroupBy(v.page.group_by === p.id ? null : p.id)
                            }
                          />
                        </th>
                      ))}
                      <th className="w-10 px-1 pb-1">
                        <button
                          onClick={v.onAddProperty}
                          title="Add property"
                          className="rounded p-1 text-txt3 hover:bg-surface2 hover:text-txt"
                        >
                          <Plus className="h-4 w-4" />
                        </button>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.items.map((r) => (
                      <tr key={r.id} className="group border-b border-border/60 hover:bg-surface/60">
                        <td className="px-1 py-1">
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => v.onOpenRecord(r)}
                              title="Open record"
                              className="shrink-0 rounded p-0.5 text-txt3 opacity-0 hover:text-txt group-hover:opacity-100"
                            >
                              <GripVertical className="h-3.5 w-3.5" />
                            </button>
                            <input
                              value={r.title}
                              onChange={(e) => v.onPatchRecord(r.id, { title: e.target.value })}
                              placeholder="Untitled"
                              className="min-w-0 flex-1 rounded bg-transparent px-1 py-1 text-sm outline-none placeholder:text-txt3 hover:bg-surface2 focus:bg-surface2"
                            />
                          </div>
                        </td>
                        {v.props.map((p) => (
                          <td key={p.id} className="px-1 py-1 align-middle">
                            <PropertyCell
                              prop={p}
                              value={r.props[p.id]}
                              onChange={(val) =>
                                v.onPatchRecord(r.id, { props: { ...r.props, [p.id]: val } })
                              }
                            />
                          </td>
                        ))}
                        <td />
                      </tr>
                    ))}
                    <tr>
                      <td colSpan={v.props.length + 2} className="px-1 py-1">
                        <button
                          onClick={() =>
                            v.onAddRecord(
                              gp && g.key !== "__none" && g.key !== "all"
                                ? { [gp.id]: g.key }
                                : undefined
                            )
                          }
                          className="flex w-full items-center gap-1.5 rounded px-1 py-1.5 text-left text-sm text-txt3 hover:bg-surface2 hover:text-txt"
                        >
                          <Plus className="h-4 w-4" /> New
                        </button>
                      </td>
                    </tr>
                  </tbody>
                </table>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ BOARD */

export function BoardView(v: ViewProps) {
  const { gp, groups } = useGroups(v.page, v.props, v.records);

  if (!gp) {
    return (
      <p className="px-8 py-10 text-sm text-txt3">
        A board needs a <strong>Select</strong> property to group by. Open a column menu and choose
        “Group by this”.
      </p>
    );
  }

  const preview = v.props.filter((p) => p.id !== gp.id).slice(0, 3);

  return (
    <div className="flex gap-3 overflow-x-auto px-4 pb-24 md:px-8">
      {groups.map((g) => (
        <div
          key={g.key}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            const id = e.dataTransfer.getData("text/cadence-record");
            if (!id) return;
            const rec = v.records.find((r) => r.id === id);
            if (!rec) return;
            v.onPatchRecord(id, {
              props: { ...rec.props, [gp.id]: g.key === "__none" ? null : g.key },
            });
          }}
          className="flex w-[260px] shrink-0 flex-col rounded-xl bg-surface/60 p-2"
        >
          <div className="mb-2 flex items-center gap-2 px-1">
            <span
              className="rounded-md px-2 py-0.5 text-xs font-semibold"
              style={{ background: `${g.color}26`, color: g.color }}
            >
              {g.label}
            </span>
            <span className="text-xs text-txt3">{g.items.length}</span>
          </div>

          <div className="flex flex-col gap-2">
            {g.items.map((r) => (
              <div
                key={r.id}
                draggable
                onDragStart={(e) => e.dataTransfer.setData("text/cadence-record", r.id)}
                onClick={() => v.onOpenRecord(r)}
                className="cursor-pointer rounded-lg border border-border bg-bg p-2.5 hover:border-accent/50"
              >
                <div className="truncate text-sm font-medium">{r.title || "Untitled"}</div>
                <div className="mt-1 space-y-0.5">
                  {preview.map((p) => {
                    const val = r.props[p.id];
                    if (val == null || val === "") return null;
                    const c = p.type === "select" ? choiceOf(p, val) : null;
                    return (
                      <div key={p.id} className="flex items-center gap-1 text-[11px] text-txt3">
                        {c ? (
                          <span
                            className="rounded px-1.5 py-0.5 font-medium"
                            style={{ background: `${c.color}26`, color: c.color }}
                          >
                            {c.label}
                          </span>
                        ) : p.type === "checkbox" ? (
                          val ? (
                            <span className="text-accent">✓ {p.name}</span>
                          ) : null
                        ) : (
                          <span className="truncate">{formatValue(val, p)}</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}

            <button
              onClick={() => v.onAddRecord(g.key === "__none" ? undefined : { [gp.id]: g.key })}
              className="flex items-center gap-1.5 rounded-lg px-2 py-2 text-left text-xs text-txt3 hover:bg-surface2 hover:text-txt"
            >
              <Plus className="h-3.5 w-3.5" /> New
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------- LIST */

export function ListView(v: ViewProps) {
  const { gp, groups } = useGroups(v.page, v.props, v.records);
  const check = v.props.find((p) => p.type === "checkbox");
  const preview = v.props.filter((p) => p.id !== gp?.id && p.id !== check?.id).slice(0, 2);

  return (
    <div className="mx-auto max-w-2xl px-4 pb-24 md:px-8">
      {groups.map((g) => (
        <div key={g.key} className="mb-5">
          {gp && (
            <div className="mb-1 flex items-center gap-2 border-b border-border pb-1">
              <span
                className="rounded-md px-2 py-0.5 text-xs font-semibold"
                style={{ background: `${g.color}26`, color: g.color }}
              >
                {g.label}
              </span>
              <span className="text-xs text-txt3">{g.items.length}</span>
            </div>
          )}
          {g.items.map((r) => (
            <div
              key={r.id}
              className="flex items-center gap-2.5 rounded-lg px-1 py-2.5 hover:bg-surface2 md:py-2"
            >
              {check && (
                <PropertyCell
                  prop={check}
                  value={r.props[check.id]}
                  onChange={(val) =>
                    v.onPatchRecord(r.id, { props: { ...r.props, [check.id]: val } })
                  }
                />
              )}
              <button
                onClick={() => v.onOpenRecord(r)}
                className={clsx(
                  "min-w-0 flex-1 truncate text-left text-[15px] md:text-sm",
                  check && r.props[check.id] ? "text-txt3 line-through" : "text-txt"
                )}
              >
                {r.title || "Untitled"}
              </button>
              <div className="flex shrink-0 items-center gap-2">
                {preview.map((p) => {
                  const val = r.props[p.id];
                  if (val == null || val === "") return null;
                  const c = p.type === "select" ? choiceOf(p, val) : null;
                  return c ? (
                    <span
                      key={p.id}
                      className="rounded px-1.5 py-0.5 text-[11px] font-medium"
                      style={{ background: `${c.color}26`, color: c.color }}
                    >
                      {c.label}
                    </span>
                  ) : (
                    <span key={p.id} className="text-[11px] text-txt3">
                      {formatValue(val, p)}
                    </span>
                  );
                })}
              </div>
            </div>
          ))}
          <button
            onClick={() => v.onAddRecord(gp && g.key !== "__none" ? { [gp.id]: g.key } : undefined)}
            className="flex items-center gap-1.5 rounded px-1 py-2 text-sm text-txt3 hover:text-txt"
          >
            <Plus className="h-4 w-4" /> New
          </button>
        </div>
      ))}
    </div>
  );
}

/* --------------------------------------------------------------- CALENDAR */

export function CalendarView(v: ViewProps) {
  const dateProps = v.props.filter((p) => p.type === "date");
  const dp = v.props.find((p) => p.id === v.page.date_prop) ?? dateProps[0] ?? null;
  const [month, setMonth] = useState(() => {
    const d = new Date();
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    return d;
  });

  if (!dp) {
    return (
      <p className="px-8 py-10 text-sm text-txt3">
        A calendar needs a <strong>Date</strong> property. Add one from the table header.
      </p>
    );
  }

  const first = new Date(month);
  const start = new Date(first);
  start.setDate(1 - first.getDay());
  const days = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });

  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  const byDay = new Map<string, PageRecord[]>();
  for (const r of v.records) {
    const val = r.props[dp.id];
    if (!val) continue;
    const k = String(val).slice(0, 10);
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k)!.push(r);
  }

  const gp = v.props.find((p) => p.id === v.page.group_by && p.type === "select") ?? null;
  const today = iso(new Date());

  return (
    <div className="px-3 pb-24 md:px-8">
      <div className="mb-2 flex items-center gap-2">
        <button
          onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
          className="rounded-lg border border-border px-2 py-1 text-xs text-txt2 hover:bg-surface"
        >
          ‹
        </button>
        <span className="text-sm font-semibold">
          {month.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
        </span>
        <button
          onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
          className="rounded-lg border border-border px-2 py-1 text-xs text-txt2 hover:bg-surface"
        >
          ›
        </button>
        <span className="ml-2 text-xs text-txt3">by “{dp.name}”</span>
      </div>

      <div className="grid grid-cols-7">
        {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
          <div key={i} className="pb-1 text-center text-[10px] uppercase text-txt3">
            {d}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-px rounded-lg bg-border">
        {days.map((d) => {
          const k = iso(d);
          const items = byDay.get(k) ?? [];
          const inMonth = d.getMonth() === month.getMonth();
          return (
            <div
              key={k}
              className={clsx(
                "min-h-[76px] bg-bg p-1",
                !inMonth && "opacity-40"
              )}
            >
              <div className="mb-0.5 flex justify-end">
                <span
                  className={clsx(
                    "flex h-5 w-5 items-center justify-center rounded-full text-[11px]",
                    k === today ? "bg-accent font-semibold text-white" : "text-txt3"
                  )}
                >
                  {d.getDate()}
                </span>
              </div>
              <div className="space-y-0.5">
                {items.slice(0, 3).map((r) => {
                  const c = gp ? choiceOf(gp, r.props[gp.id]) : null;
                  return (
                    <button
                      key={r.id}
                      onClick={() => v.onOpenRecord(r)}
                      className="block w-full truncate rounded px-1 py-0.5 text-left text-[10px]"
                      style={{
                        background: c ? `${c.color}26` : "rgba(124,108,240,0.18)",
                        color: c ? c.color : undefined,
                      }}
                    >
                      {r.title || "Untitled"}
                    </button>
                  );
                })}
                {items.length > 3 && (
                  <span className="px-1 text-[10px] text-txt3">+{items.length - 3}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
