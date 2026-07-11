"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Loader2, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/lib/toast";
import { CHOICE_COLORS, TEMPLATES, uid, type Page, type Template } from "@/lib/pages";

export default function PagesList() {
  const supabase = createClient();
  const router = useRouter();
  const [pages, setPages] = useState<Page[]>([]);
  const [loading, setLoading] = useState(true);
  const [picking, setPicking] = useState(false);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("pages")
      .select("*")
      .is("deleted_at", null)
      .order("created_at", { ascending: false });
    setPages((data as Page[]) ?? []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  const create = async (t: Template) => {
    setCreating(true);
    const { data: page, error } = await supabase
      .from("pages")
      .insert({
        title: t.id === "blank" ? "Untitled" : t.name,
        icon: t.icon,
        view: t.view,
      })
      .select()
      .single();

    if (error || !page) {
      setCreating(false);
      return toast(error?.message ?? "Couldn't create the page", "error");
    }

    const rows = t.properties.map((p, i) => ({
      page_id: page.id,
      name: p.name,
      type: p.type,
      position: i,
      options: p.choices
        ? {
            choices: p.choices.map((label, ci) => ({
              id: uid(),
              label,
              color: CHOICE_COLORS[ci % CHOICE_COLORS.length],
            })),
          }
        : {},
    }));

    if (rows.length) {
      const { data: created, error: pErr } = await supabase
        .from("page_properties")
        .insert(rows)
        .select();
      if (pErr) toast(pErr.message, "error");

      const cols = (created as { id: string; name: string }[] | null) ?? [];

      // point group_by / date_prop at the template's nominated columns
      const patch: Record<string, string> = {};
      const g = t.groupBy ? cols.find((c) => c.name === t.groupBy) : null;
      if (g) patch.group_by = g.id;
      const d = t.dateProp ? cols.find((c) => c.name === t.dateProp) : null;
      if (d) patch.date_prop = d.id;
      if (Object.keys(patch).length) {
        await supabase.from("pages").update(patch).eq("id", page.id);
      }

      // seed the standard rows, pre-set to the first stage so they group sensibly
      if (t.seed?.length) {
        const stage = g
          ? (rows.find((r) => r.name === t.groupBy)?.options as
              | { choices?: { id: string }[] }
              | undefined)?.choices?.[0]?.id
          : undefined;

        const seedRows = t.seed.map((title, i) => ({
          page_id: page.id,
          title,
          position: i,
          props: g && stage ? { [g.id]: stage } : {},
        }));
        const { error: sErr } = await supabase.from("page_records").insert(seedRows);
        if (sErr) toast(sErr.message, "error");
      }
    }

    setCreating(false);
    setPicking(false);
    router.push(`/app/pages/${page.id}`);
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-4 py-6 md:px-8">
        <div className="mb-5 flex items-center gap-3">
          <h1 className="text-2xl font-semibold">Pages</h1>
          <button
            onClick={() => setPicking(true)}
            className="ml-auto flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white active:opacity-80"
          >
            <Plus className="h-4 w-4" /> New page
          </button>
        </div>

        {loading ? (
          <Loader2 className="h-5 w-5 animate-spin text-txt3" />
        ) : pages.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-8 text-center">
            <p className="text-sm text-txt2">No pages yet.</p>
            <p className="mt-1 text-xs text-txt3">
              A page is a table you design — a CRM pipeline, a listings tracker, a checklist.
            </p>
            <button
              onClick={() => setPicking(true)}
              className="mt-4 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white"
            >
              Create one
            </button>
          </div>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {pages.map((p) => (
              <button
                key={p.id}
                onClick={() => router.push(`/app/pages/${p.id}`)}
                className="flex items-start gap-3 rounded-xl border border-border bg-surface p-4 text-left transition hover:border-accent/50"
              >
                <span className="text-xl">{p.icon ?? "📄"}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{p.title}</span>
                  <span className="block truncate text-xs text-txt3">
                    {p.description || `${p.view} view`}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {picking && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center md:justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setPicking(false)} />
          <div className="relative w-full rounded-t-2xl border-t border-border bg-surface p-4 pb-8 md:max-w-lg md:rounded-2xl md:border md:pb-4">
            <div className="mb-3 flex items-center">
              <h2 className="text-base font-semibold">Start from a template</h2>
              <button
                onClick={() => setPicking(false)}
                className="ml-auto flex h-9 w-9 items-center justify-center rounded-lg text-txt3 active:bg-surface2"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-2">
              {TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  disabled={creating}
                  onClick={() => create(t)}
                  className="flex w-full items-start gap-3 rounded-xl border border-border p-3 text-left transition hover:border-accent/60 hover:bg-surface2 disabled:opacity-50"
                >
                  <span className="text-xl">{t.icon}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{t.name}</span>
                    <span className="block text-xs text-txt3">{t.description}</span>
                  </span>
                </button>
              ))}
            </div>
            {creating && (
              <p className="mt-3 flex items-center gap-2 text-xs text-txt3">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Creating…
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
