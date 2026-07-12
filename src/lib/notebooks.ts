import type { NotebookPageTemplate } from "@/lib/types";

/** Default page size for a blank/templated page — Letter-ish at ~150dpi. */
export const DEFAULT_PAGE_W = 1240;
export const DEFAULT_PAGE_H = 1650;

export const TEMPLATE_LABELS: Record<Exclude<NotebookPageTemplate, "pdf">, string> = {
  blank: "Blank",
  lined: "Lined",
  grid: "Grid",
  dotted: "Dotted",
};

export const NOTEBOOK_COLORS = [
  "#8A5CF6",
  "#3B6FE0",
  "#20A97B",
  "#D64550",
  "#E08A2B",
  "#4B5563",
];

/** Paints the paper background (lines/grid/dots) for a template page. Call
 * before drawing strokes on top. No-op for "blank" and "pdf" (pdf paints its
 * own rendered page image as the background instead). */
export function paintTemplate(
  ctx: CanvasRenderingContext2D,
  template: NotebookPageTemplate,
  w: number,
  h: number
) {
  ctx.save();
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, w, h);

  const line = "#D8DCE6";
  const step = 40;

  if (template === "lined") {
    ctx.strokeStyle = line;
    ctx.lineWidth = 1;
    for (let y = step * 1.5; y < h; y += step) {
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(w, y + 0.5);
      ctx.stroke();
    }
  } else if (template === "grid") {
    ctx.strokeStyle = line;
    ctx.lineWidth = 1;
    for (let x = step; x < w; x += step) {
      ctx.beginPath();
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, h);
      ctx.stroke();
    }
    for (let y = step; y < h; y += step) {
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(w, y + 0.5);
      ctx.stroke();
    }
  } else if (template === "dotted") {
    ctx.fillStyle = line;
    for (let x = step; x < w; x += step) {
      for (let y = step; y < h; y += step) {
        ctx.beginPath();
        ctx.arc(x, y, 1.4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  ctx.restore();
}
