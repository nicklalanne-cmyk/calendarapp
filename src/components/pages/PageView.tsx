"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Table2, Kanban, List as ListIcon, CalendarDays, ArrowLeft, Trash2, Plus, Loader2,
} from "lucide-react";
import clsx from "clsx";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/lib/toast";
import {
  CHOICE_COLORS, uid,
  type Page, type PageProperty, type PageRecord, type PageView as View,
} from "@/lib/pages";
import { TableView, BoardView, ListView, CalendarView, type ViewProps } from "@/components/pages/PageViews";
import RecordSheet from "@/components/pages/RecordSheet";
import PropertyCell from "@/components/pages/PropertyCell";

const VIEWS: { id: View; label: string; icon: React.ElementType }[] = [
  { id: "table", label: "Table", icon: Table2 },
  { id: "board", label: "Board", icon: Kanban },
  { id: "list", label: "List", icon: ListIcon },
  { id: "calendar", label: "Calendar", icon: CalendarDays },
];

export default function PageView({ pageId }: { pageId: string }) {
  const supabase = createClient();
  const router = useRouter();

  const [page, setPage] = useState<Page | null>(null);
  const [props, setProps] = useState<PageProperty[]>([]);
  const [records, setRecords] = useState<PageRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<PageRecord | null>(null);

  const load = useCallback(async () => {
    const [{ data: p }, { data: pr }, { data: rc }] = await Promise.all([
      supabase.from("pages").select("*").eq("id", pageId).is("deleted_at", null).maybeSingle(),
      supabase.from("page_properties").select("*").eq("page_id", pageId).order("position"),
      supabase.from("page_records").select("*").eq("page_id", pageId).is("deleted_at", null).order("position"),
    ]);
    setPage((p as Page) ?? null);
    setProps((pr as PageProperty[]) ?? []);
    setRecords((rc as PageRecord[]) ?? []);
    setLoading(false);
  }, [supabase, pageId]);

  useEffect(() => {
    load();
  }, [load]);

  // keep the open sheet in sync with edits made inside it
  useEffect(() => {
    if (!open) return;
    const fresh = records.find((r) => r.id === open.id);
    if (fresh && fresh !== open) setOpen(fresh);
  }, [records, open]);

  const savePage = async (patch: Partial<Page>) => {
    if (!page) return;
    setPage({ ...page, ...patch });
    const { error } = await supabase
      .from("pages")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", page.id);
    if (error) toast(error.message, "error");
  };

  const addProperty = async () => {
    const { data, error } = await supabase
      .from("page_properties")
      .insert({ page_id: pageId, name: "New property", type: "text", position: props.length })
      .select()
      .single();
    if (error) return toast(error.message, "error");
    setProps((p) => [...p, data as PageProperty]);
  };

  const saveProperty = async (id: string, patch: Partial<PageProperty>) => {
    setProps((cur) => cur.map((p) => (p.id === id ? { ...p, ...patch } : p)));
    const { error } = await supabase.from("page_properties").update(patch).eq("id", id);
    if (error) toast(error.message, "error");
  };

  const deleteProperty = async (id: string) => {
    const prop = props.find((p) => p.id === id);
    setProps((cur) => cur.filter((p) => p.id !== id));
    const { error } = await supabase.from("page_properties").delete().eq("id", id);
    if (error) {
      toast(error.message, "error");
      return load();
    }
    if (page?.group_by === id) savePage({ group_by: null });
    toast(`Deleted “${prop?.name ?? "property"}”`, {
      action: {
        label: "Undo",
        run: async () => {
          if (!prop) return;
          const { error: e } = await supabase.from("page_properties").insert(prop);
          if (e) return toast(e.message, "error");
          load();
        },
      },
    });
  };

  const addRecord = async (seed?: Record<string, unknown>) => {
    const { data, error } = await supabase
      .from("page_records")
      .insert({ page_id: pageId, title: "", props: seed ?? {}, position: records.length })
      .select()
      .single();
    if (error) return toast(error.message, "error");
    setRecords((r) => [...r, data as PageRecord]);
  };

  const patchRecord = async (
    id: string,
    patch: { title?: string; props?: Record<string, unknown> }
  ) => {
    setRecords((cur) => cur.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    const { error } = await supabase
      .from("page_records")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) toast(error.message, "error");
  };

  const deleteRecord = async (r: PageRecord) => {
    setOpen(null);
    setRecords((cur) => cur.filter((x) => x.id !== r.id));
    const { error } = await supabase
      .from("page_records")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", r.id);
    if (error) return toast(error.message, "error");
    toast(`Deleted “${r.title || "Untitled"}”`, {
      action: {
        label: "Undo",
        run: async () => {
          const { error: e } = await supabase
            .from("page_records")
            .update({ deleted_at: null })
            .eq("id", r.id);
          if (e) return toast(e.message, "error");
          load();
        },
      },
    });
  };

  const deletePage = async () => {
    if (!page) return;
    await supabase
      .from("pages")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", page.id);
    router.push("/app/pages");
    toast(`Deleted “${page.title}”`, {
      action: {
        label: "Undo",
        run: async () => {
          await supabase.from("pages").update({ deleted_at: null }).eq("id", page.id);
          router.push(`/app/pages/${page.id}`);
        },
      },
    });
  };

  const vp: ViewProps | null = useMemo(
    () =>
      page
        ? {
            page,
            props,
            records,
            onAddRecord: addRecord,
            onPatchRecord: patchRecord,
            onOpenRecord: setOpen,
            onAddProperty: addProperty,
            onSaveProperty: saveProperty,
            onDeleteProperty: deleteProperty,
            onSetGroupBy: (id) => savePage({ group_by: id }),
          }
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [page, props, records]
  );

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-txt3" />
      </div>
    );
  }
  if (!page || !vp) {
    return <p className="p-8 text-sm text-txt3">That page doesn’t exist.</p>;
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="shrink-0 px-4 pt-3 md:px-8 md:pt-6">
        <div className="mb-1 flex items-center gap-2">
          <button
            onClick={() => router.push("/app/pages")}
            className="-ml-2 flex h-9 w-9 items-center justify-center rounded-lg text-txt3 hover:bg-surface md:hidden"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <input
            value={page.title}
            onChange={(e) => savePage({ title: e.target.value })}
            placeholder="Untitled"
            className="min-w-0 flex-1 bg-transparent text-2xl font-bold outline-none placeholder:text-txt3 md:text-3xl"
          />
          <button
            onClick={deletePage}
            title="Delete page"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-txt3 hover:bg-surface hover:text-danger"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>

        <input
          value={page.description ?? ""}
          onChange={(e) => savePage({ description: e.target.value })}
          placeholder="Add a description…"
          className="mb-3 w-full bg-transparent text-sm text-txt2 outline-none placeholder:text-txt3"
        />

        <div className="flex items-center gap-1 border-b border-border">
          {VIEWS.map((v) => {
            const Icon = v.icon;
            const active = page.view === v.id;
            return (
              <button
                key={v.id}
                onClick={() => savePage({ view: v.id })}
                className={clsx(
                  "-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition",
                  active
                    ? "border-accent text-txt"
                    : "border-transparent text-txt3 hover:text-txt2"
                )}
              >
                <Icon className="h-4 w-4" />
                <span className="hidden sm:inline">{v.label}</span>
              </button>
            );
          })}

          {page.view === "calendar" && (
            <select
              value={page.date_prop ?? ""}
              onChange={(e) => savePage({ date_prop: e.target.value || null })}
              className="ml-auto rounded-md border border-border bg-surface px-2 py-1 text-xs text-txt2 outline-none"
            >
              {props
                .filter((p) => p.type === "date")
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </select>
          )}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto pt-4">
        {/* wide tables are unusable on a phone — show cards instead */}
        {page.view === "table" ? (
          <>
            <div className="hidden md:block">
              <TableView {...vp} />
            </div>
            <div className="md:hidden">
              <MobileCards vp={vp} />
            </div>
          </>
        ) : page.view === "board" ? (
          <BoardView {...vp} />
        ) : page.view === "list" ? (
          <ListView {...vp} />
        ) : (
          <CalendarView {...vp} />
        )}
      </div>

      {open && (
        <RecordSheet
          record={open}
          props={props}
          onClose={() => setOpen(null)}
          onChange={(patch) => patchRecord(open.id, patch)}
          onDelete={() => deleteRecord(open)}
        />
      )}
    </div>
  );
}

/** Phone view of a table: one card per record. */
function MobileCards({ vp }: { vp: ViewProps }) {
  const gp = vp.props.find((p) => p.id === vp.page.group_by && p.type === "select") ?? null;
  const shown = vp.props.filter((p) => p.id !== gp?.id).slice(0, 3);

  const groups = gp
    ? [
        ...(gp.options.choices ?? []).map((c) => ({
          key: c.id,
          label: c.label,
          color: c.color,
          items: vp.records.filter((r) => r.props[gp.id] === c.id),
        })),
        {
          key: "__none",
          label: "No status",
          color: "#6E6E7A",
          items: vp.records.filter(
            (r) => !(gp.options.choices ?? []).some((c) => c.id === r.props[gp.id])
          ),
        },
      ].filter((g) => g.items.length > 0 || g.key !== "__none")
    : [{ key: "all", label: "", color: "", items: vp.records }];

  return (
    <div className="px-4 pb-24">
      {groups.map((g) => (
        <div key={g.key} className="mb-5">
          {gp && (
            <div className="mb-2 flex items-center gap-2">
              <span
                className="rounded-md px-2 py-0.5 text-xs font-semibold"
                style={{ background: `${g.color}26`, color: g.color }}
              >
                {g.label}
              </span>
              <span className="text-xs text-txt3">{g.items.length}</span>
            </div>
          )}
          <div className="space-y-2">
            {g.items.map((r) => (
              <button
                key={r.id}
                onClick={() => vp.onOpenRecord(r)}
                className="block w-full rounded-xl border border-border bg-surface p-3 text-left active:bg-surface2"
              >
                <div className="truncate text-[15px] font-medium">{r.title || "Untitled"}</div>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                  {shown.map((p) => {
                    const val = r.props[p.id];
                    if (val == null || val === "") return null;
                    return (
                      <span key={p.id} className="flex items-center gap-1 text-xs text-txt3">
                        <PropertyCell prop={p} value={val} onChange={() => {}} compact />
                      </span>
                    );
                  })}
                </div>
              </button>
            ))}
            <button
              onClick={() =>
                vp.onAddRecord(gp && g.key !== "__none" ? { [gp.id]: g.key } : undefined)
              }
              className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-border py-3 text-sm text-txt3 active:bg-surface2"
            >
              <Plus className="h-4 w-4" /> New
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
