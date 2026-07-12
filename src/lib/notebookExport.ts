import { jsPDF } from "jspdf";
import { drawStroke } from "@/lib/ink";
import { paintTemplate } from "@/lib/notebooks";
import type { NotebookPage } from "@/lib/types";

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number
) {
  const words = text.split(/\s+/);
  let line = "";
  let cy = y;
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line, x, cy);
      line = w;
      cy += lineHeight;
    } else {
      line = test;
    }
  }
  if (line) ctx.fillText(line, x, cy);
}

/** Renders one page (template/PDF background + ink + text/image elements)
 * to a flat canvas — used for both PDF export and page thumbnails. */
export async function renderPageToCanvas(
  page: NotebookPage,
  background: HTMLCanvasElement | HTMLImageElement | null,
  resolveImageUrl: (storagePath: string) => Promise<string | null>
): Promise<HTMLCanvasElement> {
  const canvas = document.createElement("canvas");
  canvas.width = page.width;
  canvas.height = page.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, page.width, page.height);
  if (background) {
    ctx.drawImage(background, 0, 0, page.width, page.height);
  } else {
    paintTemplate(ctx, page.template, page.width, page.height);
  }

  for (const el of page.elements ?? []) {
    if (el.type === "image") {
      const url = await resolveImageUrl(el.storagePath);
      if (!url) continue;
      try {
        const img = await loadImage(url);
        ctx.save();
        if (el.rotation) {
          ctx.translate(el.x + el.w / 2, el.y + el.h / 2);
          ctx.rotate((el.rotation * Math.PI) / 180);
          ctx.drawImage(img, -el.w / 2, -el.h / 2, el.w, el.h);
        } else {
          ctx.drawImage(img, el.x, el.y, el.w, el.h);
        }
        ctx.restore();
      } catch {
        /* broken image link — skip it rather than fail the whole export */
      }
    }
  }

  for (const s of page.strokes) drawStroke(ctx, s);

  for (const el of page.elements ?? []) {
    if (el.type === "text") {
      ctx.save();
      ctx.fillStyle = el.color;
      ctx.font = `${el.fontSize}px "Inter", sans-serif`;
      ctx.textBaseline = "top";
      wrapText(ctx, el.text, el.x, el.y, el.w, el.fontSize * 1.3);
      ctx.restore();
    }
  }

  return canvas;
}

/** Assembles every page of a notebook into a downloadable PDF, entirely
 * client-side — each page is flattened to a PNG via renderPageToCanvas and
 * placed on its own PDF page sized to match. */
export async function exportNotebookToPdf(
  title: string,
  pages: NotebookPage[],
  getBackground: (page: NotebookPage) => Promise<HTMLCanvasElement | HTMLImageElement | null>,
  resolveImageUrl: (storagePath: string) => Promise<string | null>,
  onProgress?: (done: number, total: number) => void
) {
  if (pages.length === 0) return;
  let doc: jsPDF | null = null;

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const bg = await getBackground(page);
    const canvas = await renderPageToCanvas(page, bg, resolveImageUrl);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
    const orientation = page.width >= page.height ? "l" : "p";

    if (!doc) {
      doc = new jsPDF({ unit: "px", format: [page.width, page.height], orientation });
    } else {
      doc.addPage([page.width, page.height], orientation);
    }
    doc.addImage(dataUrl, "JPEG", 0, 0, page.width, page.height);
    onProgress?.(i + 1, pages.length);
  }

  doc?.save(`${title || "Notebook"}.pdf`);
}
