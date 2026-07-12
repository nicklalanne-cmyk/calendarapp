// Thin wrapper around pdfjs-dist for rendering PDF pages to <canvas> images
// that become the background of a notebook page. Loaded lazily (dynamic
// import) so the ~1MB pdf.js bundle never ships to people who don't import a PDF.

let configured = false;

async function getPdfjs() {
  const pdfjsLib = await import("pdfjs-dist");
  if (!configured) {
    // Served from /public (see scripts/copy-pdf-worker.js) rather than
    // bundled via `new URL(...)` — Next's production Terser pass can't
    // re-minify the worker's own ESM syntax, so it has to ship untouched.
    pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
    configured = true;
  }
  return pdfjsLib;
}

export async function loadPdfDocument(source: string | ArrayBuffer) {
  const pdfjsLib = await getPdfjs();
  const task =
    typeof source === "string"
      ? pdfjsLib.getDocument({ url: source })
      : pdfjsLib.getDocument({ data: source });
  return task.promise;
}

const TARGET_LONG_EDGE = 1600;

/** Dimensions a rendered page will have — used both to size the stored
 * notebook_pages row at import time and to render at that exact size later,
 * so strokes drawn against one always line up with the other. */
export async function pdfPageDims(
  doc: Awaited<ReturnType<typeof loadPdfDocument>>,
  pageIndex: number
): Promise<{ width: number; height: number }> {
  const page = await doc.getPage(pageIndex + 1); // pdf.js pages are 1-indexed
  const base = page.getViewport({ scale: 1 });
  const scale = TARGET_LONG_EDGE / Math.max(base.width, base.height);
  return { width: Math.round(base.width * scale), height: Math.round(base.height * scale) };
}

/** Render one page (0-indexed) of a loaded PDF document to a canvas at the
 * same dimensions pdfPageDims() reports for it. */
export async function renderPdfPage(
  doc: Awaited<ReturnType<typeof loadPdfDocument>>,
  pageIndex: number
): Promise<{ canvas: HTMLCanvasElement; width: number; height: number }> {
  const page = await doc.getPage(pageIndex + 1);
  const base = page.getViewport({ scale: 1 });
  const scale = TARGET_LONG_EDGE / Math.max(base.width, base.height);
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not get canvas context");
  await page.render({ canvasContext: ctx, viewport }).promise;

  return { canvas, width: canvas.width, height: canvas.height };
}
