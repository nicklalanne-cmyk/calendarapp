"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft, Plus, Trash2, Copy, Loader2, FileUp, ChevronLeft, ChevronRight,
  Menu, X, Users, Download, Maximize2, Minimize2,
} from "lucide-react";
import clsx from "clsx";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/lib/toast";
import { makeDebouncer } from "@/lib/debounce";
import { DEFAULT_PAGE_H, DEFAULT_PAGE_W, TEMPLATE_LABELS } from "@/lib/notebooks";
import { loadPdfDocument, pdfPageDims, renderPdfPage } from "@/lib/notebookPdf";
import type { Notebook, NotebookPage, NotebookPageElement, NotebookPageTemplate, NotebookPdf } from "@/lib/types";
import type { Stroke } from "@/lib/ink";
import NotebookCanvas from "@/components/notebooks/NotebookCanvas";

const saveDebouncer = makeDebouncer(600);

export default function NotebookEditor({ notebookId }: { notebookId: string }) {
  const supabase = createClient();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [notebook, setNotebook] = useState<Notebook | null>(null);
  const [pages, setPages] = useState<NotebookPage[]>([]);
  const [pdfs, setPdfs] = useState<Record<string, NotebookPdf>>({});
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [railOpen, setRailOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState<string | null>(null);
  const [exporting, setExporting] = useState<string | null>(null);
  const [background, setBackground] = useState<HTMLCanvasElement | null>(null);
  const [isOwner, setIsOwner] = useState(true);
  // Same "escape everything, including AppShell's bottom nav" trick as
  // InkCanvas's full-screen toggle — a fixed inset-0 overlay at a z-index
  // above the mobile bottom nav, plus a real Fullscreen API request where
  // supported, so nothing but the editor itself is left to catch a stray
  // arm/palm while writing.
  const [full, setFull] = useState(false);

  const fileRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const pdfDocCache = useRef<Map<string, Awaited<ReturnType<typeof loadPdfDocument>>>>(new Map());
  const bgCache = useRef<Map<string, HTMLCanvasElement>>(new Map());
  const imageUrlCache = useRef<Map<string, string>>(new Map());
  const dragId = useRef<string | null>(null);
  const autoImportTried = useRef(false);

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
      elements: (p.elements as unknown as NotebookPageElement[]) ?? [],
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

  // Flush any in-flight page/element/title autosave before unmount/navigate.
  // saveDebouncer is module-scoped (shared across all NotebookEditor mounts),
  // but flushAll() only touches whatever keys are currently pending, so this
  // still correctly flushes just this instance's outstanding writes.
  useEffect(() => {
    return () => {
      saveDebouncer.flushAll();
    };
  }, []);

  // ?import=1 — set by NotebooksView when the user picked "Import a PDF" as
  // the starting page style, so the file picker opens the moment we land here.
  useEffect(() => {
    if (loading || autoImportTried.current) return;
    if (searchParams.get("import") === "1") {
      autoImportTried.current = true;
      setTimeout(() => fileRef.current?.click(), 200);
    }
  }, [loading, searchParams]);

  // Resolves (and caches) the rendered background for any page — the PDF page
  // image if it's a PDF page, or null for a template page (NotebookCanvas
  // paints the template itself). Shared by the "show the active page" effect
  // below and by full-notebook PDF export.
  const loadBackgroundFor = useCallback(
    async (page: NotebookPage): Promise<HTMLCanvasElement | null> => {
      if (page.template !== "pdf" || page.pdf_id == null || page.pdf_page_index == null) return null;
      const cached = bgCache.current.get(page.id);
      if (cached) return cached;
      try {
        let doc = pdfDocCache.current.get(page.pdf_id);
        if (!doc) {
          const pdfRow = pdfs[page.pdf_id];
          if (!pdfRow) return null;
          const { data: signed } = await supabase.storage
            .from("notebook-pdfs")
            .createSignedUrl(pdfRow.storage_path, 3600);
          if (!signed?.signedUrl) return null;
          doc = await loadPdfDocument(signed.signedUrl);
          pdfDocCache.current.set(page.pdf_id, doc);
        }
        const { canvas } = await renderPdfPage(doc, page.pdf_page_index);
        bgCache.current.set(page.id, canvas);
        return canvas;
      } catch {
        return null;
      }
    },
    [supabase, pdfs]
  );

  // render/cache the background for whichever page is active
  useEffect(() => {
    if (!active) {
      setBackground(null);
      return;
    }
    let cancelled = false;
    loadBackgroundFor(active).then((canvas) => {
      if (!cancelled) setBackground(canvas);
    });
    return () => {
      cancelled = true;
    };
  }, [active, loadBackgroundFor]);

  const resolveImageUrl = useCallback(
    async (storagePath: string): Promise<string | null> => {
      const cached = imageUrlCache.current.get(storagePath);
      if (cached) return cached;
      const { data } = await supabase.storage.from("notebook-images").createSignedUrl(storagePath, 3600);
      if (!data?.signedUrl) return null;
      imageUrlCache.current.set(storagePath, data.signedUrl);
      return data.signedUrl;
    },
    [supabase]
  );

  const insertImage = useCallback(
    async (file: File): Promise<string | null> => {
      const { data: u } = await supabase.auth.getUser();
      const uid = u.user?.id;
      if (!uid) {
        toast("Not signed in", "error");
        return null;
      }
      const path = `${uid}/${notebookId}/${Date.now()}-${file.name}`;
      const { error } = await supabase.storage
        .from("notebook-images")
        .upload(path, file, { contentType: file.type || "image/png" });
      if (error) {
        toast(error.message, "error");
        return null;
      }
      return path;
    },
    [supabase, notebookId]
  );

  const saveStrokes = (pageId: string, strokes: Stroke[]) => {
    setPages((prev) => prev.map((p) => (p.id === pageId ? { ...p, strokes } : p)));
    saveDebouncer.run(`nbpage:${pageId}`, async () => {
      const { error } = await supabase
        .from("notebook_pages")
        .update({ strokes, updated_at: new Date().toISOString() })
        .eq("id", pageId);
      if (error) toast(error.message, "error");
    });
  };

  const saveElements = (pageId: string, elements: NotebookPageElement[]) => {
    setPages((prev) => prev.map((p) => (p.id === pageId ? { ...p, elements } : p)));
    saveDebouncer.run(`nbelements:${pageId}`, async () => {
      const { error } = await supabase
        .from("notebook_pages")
        .update({ elements, updated_at: new Date().toISOString() })
        .eq("id", pageId);
      if (error) toast(error.message, "error");
    });
  };

  const exportPdf = async () => {
    if (!notebook || pages.length === 0) return;
    setExporting("Preparing…");
    try {
      // jsPDF is ~150kB — dynamic-imported so it only ever downloads for
      // someone who actually clicks Export, not on every notebook page load.
      const { exportNotebookToPdf } = await import("@/lib/notebookExport");
      await exportNotebookToPdf(
        notebook.title,
        pages,
        loadBackgroundFor,
        resolveImageUrl,
        (done, total) => setExporting(`Rendering page ${done}/${total}…`)
      );
    } catch {
      toast("Couldn't export that notebook", "error");
    } finally {
      setExporting(null);
    }
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
        elements: p.elements,
      })
      .select()
      .single();
    if (error || !data) return toast(error?.message ?? "Couldn't duplicate the page", "error");
    const page = { ...(data as NotebookPage), strokes: p.strokes, elements: p.elements };
    setPages((prev) => [...prev, page]);
    setActiveId(page.id);
  };

  // notebook_pages has no deleted_at column, so hold the real delete behind
  // a cancellable timer (same pattern as automations/notebook folders) rather
  // than a blocking window.confirm() with no way back.
  const deletePage = (p: NotebookPage) => {
    if (pages.length <= 1) return toast("A notebook needs at least one page", "error");
    const idx = pages.findIndex((x) => x.id === p.id);
    const remaining = pages.filter((x) => x.id !== p.id);
    setPages(remaining);
    if (activeId === p.id) setActiveId(remaining[0]?.id ?? null);
    let cancelled = false;
    const timer = setTimeout(async () => {
      if (cancelled) return;
      const { error } = await supabase.from("notebook_pages").delete().eq("id", p.id);
      if (error) toast(error.message, "error");
    }, 6000);
    toast("Deleted page", {
      action: {
        label: "Undo",
        run: () => {
          cancelled = true;
          clearTimeout(timer);
          setPages((prev) => {
            const next = [...prev];
            next.splice(Math.min(idx, next.length), 0, p);
            return next;
          });
          setActiveId(p.id);
        },
      },
    });
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
    saveDebouncer.run(`nbtitle:${notebookId}`, async () => {
      const { error } = await supabase.from("notebooks").update({ title }).eq("id", notebookId);
      if (error) toast(error.message, "error");
    });
  };

  const activeIndex = pages.findIndex((p) => p.id === activeId);
  const goto = (dir: 1 | -1) => {
    const next = pages[activeIndex + dir];
    if (next) setActiveId(next.id);
  };

  const toggleFull = async () => {
    const next = !full;
    setFull(next);
    try {
      if (next) {
        await rootRef.current?.requestFullscreen?.();
      } else if (document.fullscreenElement) {
        await document.exitFullscreen();
      }
    } catch {
      // Refused or unsupported — the fixed-overlay part still works, so we
      // just carry on without the browser chrome hidden too.
    }
  };

  // Leaving fullscreen via the system gesture / Esc must un-expand us too.
  useEffect(() => {
    const onFs = () => {
      if (!document.fullscreenElement && full) setFull(false);
    };
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, [full]);

  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setFull(false);
        if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [full]);

  if (loading || !notebook) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-txt3" />
      </div>
    );
  }

  return (
    <div
      ref={rootRef}
      className={clsx(
        "flex min-w-0 bg-bg",
        full ? "fixed inset-0 z-[80] h-[100dvh]" : "h-full"
      )}
    >
      {/* page rail */}
      <aside
        className={clsx(
          "flex w-56 shrink-0 flex-col border-r border-border bg-surface lg:relative lg:flex",
          railOpen ? "fixed inset-y-0 left-0 z-40 w-72" : "hidden"
        )}
      >
        {railOpen && (
          <div className="flex items-center justify-between border-b border-border p-2 lg:hidden">
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
        <div className="fixed inset-0 z-30 bg-black/40 lg:hidden" onClick={() => setRailOpen(false)} />
      )}

      {/* main */}
      <section className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex items-center gap-2 border-b border-border px-2 py-1.5">
          <button
            onClick={() => setRailOpen((v) => !v)}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-txt2 hover:bg-surface2 lg:hidden"
          >
            <Menu className="h-5 w-5" />
          </button>
          <button
            onClick={() => router.push("/app/notebooks")}
            className="hidden h-9 w-9 items-center justify-center rounded-lg text-txt2 hover:bg-surface2 lg:flex"
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
          <button
            onClick={exportPdf}
            disabled={!!exporting}
            title="Export notebook as PDF"
            className="flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs text-txt2 hover:bg-surface2 disabled:opacity-60"
          >
            {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            <span className="hidden sm:inline">{exporting ?? "Export PDF"}</span>
          </button>
          <button
            onClick={toggleFull}
            title={full ? "Exit full screen (Esc)" : "Full screen — hides the bottom nav bar"}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-txt2 hover:bg-surface2"
          >
            {full ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </button>
        </header>

        <div className="min-h-0 flex-1">
          {active ? (
            <NotebookCanvas
              key={active.id}
              strokes={active.strokes}
              elements={active.elements}
              width={active.width || DEFAULT_PAGE_W}
              height={active.height || DEFAULT_PAGE_H}
              template={active.template}
              background={background}
              onChange={(strokes) => saveStrokes(active.id, strokes)}
              onElementsChange={(elements) => saveElements(active.id, elements)}
              onInsertImage={isOwner ? insertImage : undefined}
              resolveImageUrl={resolveImageUrl}
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
          </div>
        </div>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="application/pdf"
        className="hidden"
        onChange={(e) => e.target.files?.[0] && importPdf(e.target.files[0])}
      />
    </div>
  );
}
