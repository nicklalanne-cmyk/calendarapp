"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, Plus, Trash2, Copy, Loader2, FileUp, ChevronLeft, ChevronRight,
  Menu, X, Users,
} from "lucide-react";
import clsx from "clsx";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/lib/toast";
import { makeDebouncer } from "@/lib/debounce";
import { DEFAULT_PAGE_H, DEFAULT_PAGE_W, TEMPLATE_LABELS } from "@/lib/notebooks";
import { loadPdfDocument, pdfPageDims, renderPdfPage } from "@/lib/notebookPdf";
import type { Notebook, NotebookPage, NotebookPageTemplate, NotebookPdf } from "@/lib/types";
import type { Stroke } from "@/lib/ink";
import NotebookCanvas from "@/components/notebooks/NotebookCanvas";

const strokesDebouncer = makeDebouncer(600);

export default function NotebookEditor({ notebookId }: { notebookId: string }) {
  const supabase = createClient();
  const router = useRouter();

  const [notebook, setNotebook] = useState<Notebook | null>(null);
  const [pages, setPages] = useState<NotebookPage[]>([]);
  const [pdfs, setPdfs] = useState<Record<string, NotebookPdf>>({});
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [railOpen, setRailOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState<string | null>(null);
  const [background, setBackground] = useState<HTMLCanvasElement | null>(null);
  const [isOwner, setIsOwner] = useState(true);

  const fileRef = useRef<HTMLInputElement>(null);
  const pdfDocCache = useRef<Map<string, Awaited<ReturnType<typeof loadPdfDocument>>>>(new Map());
  const bgCache = useRef<Map<string, HTMLCanvasElement>>(new Map());
  const dragId = useRef<string | null>(null);

  const active = pages.find((p) => p.id === activeId) ?? null;

  const load = useCallback(async () => {
    const [{ data: u }, { data: nb }, { data: pgs }, { data: pdfRows }] = await Promise.all([
      supabase.auth.getUser(),
      supabase.from("notebooks").select("*").eq("id", notebookId).single(),
      supabase.from("notebook_pages").select("*").eq("notebook_id", notebookId).order("position"),
      supabase.from("notebook_pdfs").select("*").eq("notebook_id", notebookId),
    ]);
    if (!nb) {
      toast("Notebook not found", "error");
      router.push("/app/notebooks");
      return;
    }
    setNotebook(nb as Notebook);
    setIsOwner((nb as Notebook).user_id === u.user?.id);
    const pl = ((pgs as NotebookPage[] | null) ?? []).map((p) => ({
      ...p,
      strokes: (p.strokes as unknown as Stroke[]) ?? [],
    }));
    setPages(pl);
    const map: Record<string, NotebookPdf> = {};
    ((pdfRows as NotebookPdf[] | null) ?? []).forEach((p) => (map[p.id] = p));
    setPdfs(map);
    setActiveId((cur) => cur ?? pl[0]?.id ?? null);
    setLoading(false);
  }, [supabase, notebookId, router]);

  useEffect(() => {
    load();
  }, [load]);

  // render/cache the background for whichever page is active
  useEffect(() => {
    if (!active) {
      setBackground(null);
      return;
    }
    if (active.template !== "pdf" || active.pdf_id == null || active.pdf_page_index == null) {
      setBackground(null);
      return;
    }
    const cacheKey = active.id;
    const cached = bgCache.current.get(cacheKey);
    if (cached) {
      setBackground(cached);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        let doc = pdfDocCache.current.get(active.pdf_id!);
        if (!doc) {
          const pdfRow = pdfs[active.pdf_id!];
          if (!pdfRow) return;
          const { data: signed } = await supabase.storage
            .from("notebook-pdfs")
            .createSignedUrl(pdfRow.storage_path, 3600);
          if (!signed?.signedUrl) return;
          doc = await loadPdfDocument(signed.signedUrl);
          pdfDocCache.current.set(active.pdf_id!, doc);
        }
        const { canvas } = await renderPdfPage(doc, active.pdf_page_index!);
        if (cancelled) return;
        bgCache.current.set(cacheKey, canvas);
        setBackground(canvas);
      } catch (err) {
        if (!cancelled) toast("Couldn't render that PDF page", "error");
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id, active?.pdf_id, active?.pdf_page_index, pdfs]);

  const saveStrokes = (pageId: string, strokes: Stroke[]) => {
    setPages((prev) => prev.map((p) => (p.id === pageId ? { ...p, strokes } : p)));
    strokesDebouncer.run(`nbpage:${pageId}`, async () => {
      const { error } = await supabase
        .from("notebook_pages")
        .update({ strokes, updated_at: new Date().toISOString() })
        .eq("id", pageId);
      if (error) toast(error.message, "error");
    });
  };

  const addPage = async (template: NotebookPageTemplate) => {
    setAdding(false);
    const position = pages.length;
    const { data, error } = await supabase
      .from("notebook_pages")
      .insert({ notebook_id: notebookId, position, template })
      .select()
      .single();
    if (error || !data) return toast(error?.message ?? "Couldn't add the page", "error");
    const page = { ...(data as NotebookPage), strokes: [] };
    setPages((prev) => [...prev, page]);
    setActiveId(page.id);
    setRailOpen(false);
  };

  const duplicatePage = async (p: NotebookPage) => {
    const position = pages.length;
    const { data, error } = await supabase
      .from("notebook_pages")
      .insert({
        notebook_id: notebookId,
        position,
        template: p.template,
        pdf_id: p.pdf_id,
        pdf_page_index: p.pdf_page_index,
        width: p.width,
        height: p.height,
        strokes: p.strokes,
      })
      .select()
      .single();
    if (error || !data) return toast(error?.message ?? "Couldn't duplicate the page", "error");
    const page = { ...(data as NotebookPage), strokes: p.strokes };
    setPages((prev) => [...prev, page]);
    setActiveId(page.id);
  };

  const deletePage = async (p: NotebookPage) => {
    if (pages.length <= 1) return toast("A notebook needs at least one page", "error");
    if (!confirm("Delete this page?")) return;
    const remaining = pages.filter((x) => x.id !== p.id);
    setPages(remaining);
    if (activeId === p.id) setActiveId(remaining[0]?.id ?? null);
    const { error } = await supabase.from("notebook_pages").delete().eq("id", p.id);
    if (error) toast(error.message, "error");
  };

  const reorder = async (fromId: string, toId: string) => {
    if (fromId === toId) return;
    const list = [...pages];
    const fromIdx = list.findIndex((p) => p.id === fromId);
    const toIdx = list.findIndex((p) => p.id === toId);
    if (fromIdx < 0 || toIdx < 0) return;
    const [moved] = list.splice(fromIdx, 1);
    list.splice(toIdx, 0, moved);
    const withPos = list.map((p, i) => ({ ...p, position: i }));
    setPages(withPos);
    await Promise.all(
      withPos.map((p) => supabase.from("notebook_pages").update({ position: p.position }).eq("id", p.id))
    );
  };

  const importPdf = async (file: File) => {
    setImporting(file.name);
    try {
      const { data: u } = await supabase.auth.getUser();
      const uid = u.user?.id;
      if (!uid) throw new Error("Not signed in");

      const buf = await file.arrayBuffer();
      const doc = await loadPdfDocument(buf.slice(0));
      const pageCount = doc.numPages;

      const path = `${uid}/${notebookId}/${Date.now()}-${file.name}`;
      const { error: upErr } = await supabase.storage
        .from("notebook-pdfs")
        .upload(path, file, { contentType: "application/pdf" });
      if (upErr) throw upErr;

      const { data: pdfRow, error: pdfErr } = await supabase
        .from("notebook_pdfs")
        .insert({ notebook_id: notebookId, storage_path: path, filename: file.name, page_count: pageCount })
        .select()
        .single();
      if (pdfErr || !pdfRow) throw pdfErr ?? new Error("Couldn't save the PDF");

      pdfDocCache.current.set(pdfRow.id, doc);
      setPdfs((prev) => ({ ...prev, [pdfRow.id]: pdfRow as NotebookPdf }));

      let position = pages.length;
      const newPages: NotebookPage[] = [];
      for (let i = 0; i < pageCount; i++) {
        const dims = await pdfPageDims(doc, i);
        const { data, error } = await supabase
          .from("notebook_pages")
          .insert({
            notebook_id: notebookId,
            position: position++,
            template: "pdf",
            pdf_id: pdfRow.id,
            pdf_page_index: i,
            width: dims.width,
            height: dims.height,
          })
          .select()
          .single();
        if (error || !data) throw error ?? new Error("Couldn't add a page");
        newPages.push({ ...(data as NotebookPage), strokes: [] });
      }

      setPages((prev) => [...prev, ...newPages]);
      setActiveId(newPages[0]?.id ?? null);
      setRailOpen(false);
      toast(`Imported "${file.name}" — ${pageCount} page${pageCount === 1 ? "" : "s"}`);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't import that PDF", "error");
    } finally {
      setImporting(null);
      setAdding(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const rename = async (title: string) => {
    if (!notebook) return;
    setNotebook({ ...notebook, title });
    strokesDebouncer.run(`nbtitle:${notebookId}`, async () => {
      const { error } = await supabase.from("notebooks").update({ title }).eq("id", notebookId);
      if (error) toast(error.message, "error");
    });
  };

  const activeIndex = pages.findIndex((p) => p.id === activeId);
  const goto = (dir: 1 | -1) => {
    const next = pages[activeIndex + dir];
    if (next) setActiveId(next.id);
  };

  if (loading || !notebook) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-txt3" />
      </div>
    );
  }

  return (
    <div className="flex h-full min-w-0">
      {/* page rail */}
      <aside
        className={clsx(
          "flex w-56 shrink-0 flex-col border-r border-border bg-surface md:relative md:flex",
          railOpen ? "fixed inset-y-0 left-0 z-40 w-72" : "hidden"
        )}
      >
        {railOpen && (
          <div className="flex items-center justify-between border-b border-border p-2 md:hidden">
            <span className="text-sm font-medium">Pages</span>
            <button onClick={() => setRailOpen(false)} className="rounded-lg p-2 text-txt3">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {pages.map((p, i) => (
            <div
              key={p.id}
              draggable={isOwner}
              onDragStart={() => (dragId.current = p.id)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => dragId.current && reorder(dragId.current, p.id)}
              onClick={() => {
                setActiveId(p.id);
                setRailOpen(false);
              }}
              className={clsx(
                "group mb-2 flex cursor-pointer items-center gap-2 rounded-lg border p-1.5 text-left transition",
                p.id === activeId ? "border-accent bg-surface2" : "border-transparent hover:bg-surface2"
              )}
            >
              <div
                className="flex aspect-[3/4] w-12 shrink-0 items-center justify-center rounded border border-border bg-white text-[10px] text-txt3"
                style={{ aspectRatio: `${p.width} / ${p.height}` }}
              >
                {i + 1}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs text-txt2">
                  {p.template === "pdf" ? "PDF page" : TEMPLATE_LABELS[p.template]}
                </div>
                <div className="text-[11px] text-txt3">Page {i + 1}</div>
              </div>
              {isOwner && (
                <div className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      duplicatePage(p);
                    }}
                    title="Duplicate"
                    className="rounded p-1 text-txt3 hover:bg-surface hover:text-txt"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      deletePage(p);
                    }}
                    title="Delete"
                    className="rounded p-1 text-txt3 hover:bg-surface hover:text-danger"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>

        {isOwner && (
          <div className="border-t border-border p-2">
            <button
              onClick={() => setAdding(true)}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white"
            >
              <Plus className="h-4 w-4" /> Add page
            </button>
          </div>
        )}
      </aside>
      {railOpen && (
        <div className="fixed inset-0 z-30 bg-black/40 md:hidden" onClick={() => setRailOpen(false)} />
      )}

      {/* main */}
      <section className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex items-center gap-2 border-b border-border px-2 py-1.5">
          <button
            onClick={() => setRailOpen((v) => !v)}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-txt2 hover:bg-surface2 md:hidden"
          >
            <Menu className="h-5 w-5" />
          </button>
          <button
            onClick={() => router.push("/app/notebooks")}
            className="hidden h-9 w-9 items-center justify-center rounded-lg text-txt2 hover:bg-surface2 md:flex"
            title="Back to notebooks"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <input
            value={notebook.title}
            onChange={(e) => rename(e.target.value)}
            disabled={!isOwner}
            className="min-w-0 flex-1 truncate bg-transparent text-sm font-semibold outline-none md:text-base"
          />
          {!isOwner && notebook.shared && (
            <span title="Shared with you" className="text-accentSoft">
              <Users className="h-4 w-4" />
            </span>
          )}
          <div className="flex items-center gap-1 text-xs text-txt3">
            <button
              onClick={() => goto(-1)}
              disabled={activeIndex <= 0}
              className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-surface2 disabled:opacity-30"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="tabular-nums">
              {pages.length ? activeIndex + 1 : 0}/{pages.length}
            </span>
            <button
              onClick={() => goto(1)}
              disabled={activeIndex >= pages.length - 1}
              className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-surface2 disabled:opacity-30"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1">
          {active ? (
            <NotebookCanvas
              key={active.id}
              strokes={active.strokes}
              width={active.width || DEFAULT_PAGE_W}
              height={active.height || DEFAULT_PAGE_H}
              template={active.template}
              background={background}
              onChange={(strokes) => saveStrokes(active.id, strokes)}
              readOnly={!isOwner}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-txt3">No pages yet.</div>
          )}
        </div>
      </section>

      {adding && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center md:justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => !importing && setAdding(false)} />
          <div className="relative w-full rounded-t-2xl border-t border-border bg-surface p-4 pb-8 md:max-w-sm md:rounded-2xl md:border md:pb-4">
            <div className="mb-3 flex items-center">
              <h2 className="text-base font-semibold">Add a page</h2>
              <button
                onClick={() => !importing && setAdding(false)}
                className="ml-auto flex h-9 w-9 items-center justify-center rounded-lg text-txt3 active:bg-surface2"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              {(Object.keys(TEMPLATE_LABELS) as (keyof typeof TEMPLATE_LABELS)[]).map((t) => (
                <button
                  key={t}
                  onClick={() => addPage(t)}
                  className="rounded-xl border border-border p-3 text-left text-sm font-medium hover:border-accent/60 hover:bg-surface2"
                >
                  {TEMPLATE_LABELS[t]}
                </button>
              ))}
            </div>

            <button
              onClick={() => fileRef.current?.click()}
              disabled={!!importing}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border p-3 text-sm font-medium text-txt2 hover:border-accent/60 hover:bg-surface2 disabled:opacity-60"
            >
              {importing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Importing {importing}…
                </>
              ) : (
                <>
                  <FileUp className="h-4 w-4" /> Import a PDF
                </>
              )}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="application/pdf"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && importPdf(e.target.files[0])}
            />
          </div>
        </div>
      )}
    </div>
  );
}
