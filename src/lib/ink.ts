import getStroke from "perfect-freehand";

/** A single sampled pen point: x, y, pressure. */
export type InkPoint = [number, number, number];

export type Tool = "pen" | "highlighter" | "eraser";

export type ShapeKind = "line" | "rect" | "ellipse";

export type Stroke = {
  id: string;
  tool: Exclude<Tool, "eraser">;
  color: string;
  size: number;
  points: InkPoint[];
  /** When set, this stroke is a geometric shape and is rendered with plain
   * canvas primitives instead of the perfect-freehand outline algorithm
   * (which produces self-intersecting geometry at sharp corners). The
   * `points` array is still kept in sync so hit-testing/erasing/lasso all
   * continue to work unchanged. */
  shape?: ShapeKind;
};

export type InkDoc = {
  v: 1;
  strokes: Stroke[];
};

/** Logical page width. Everything is stored in this space and scaled to fit. */
export const PAGE_W = 1240;
export const PAGE_START_H = 1650;
export const PAGE_GROW = 700;

export const PEN_COLORS = [
  "#111318", // ink black
  "#3B6FE0", // blue
  "#D64550", // red
  "#20A97B", // green
  "#8A5CF6", // violet
  "#E08A2B", // amber
];
export const HIGHLIGHTER_COLORS = ["#FFE066", "#A6F0C6", "#BFD8FF", "#FFC9DE"];

export const PEN_SIZES = [2, 3.5, 6, 10];
export const HIGHLIGHTER_SIZES = [16, 26, 38];

const PEN_OPTS = {
  thinning: 0.62,
  smoothing: 0.55,
  streamline: 0.42,
  easing: (t: number) => Math.sin((t * Math.PI) / 2),
  simulatePressure: false,
};

const HIGHLIGHTER_OPTS = {
  thinning: 0,
  smoothing: 0.5,
  streamline: 0.4,
  easing: (t: number) => t,
  simulatePressure: false,
};

/** Outline polygon -> SVG/Canvas path data. */
export function strokeToPath(s: Stroke): Path2D {
  const opts = s.tool === "highlighter" ? HIGHLIGHTER_OPTS : PEN_OPTS;
  const outline = getStroke(s.points, {
    size: s.size,
    ...opts,
    last: true,
  }) as number[][];

  const p = new Path2D();
  if (outline.length === 0) return p;

  p.moveTo(outline[0][0], outline[0][1]);
  // quadratic through midpoints keeps the edge smooth
  for (let i = 1; i < outline.length; i++) {
    const [x0, y0] = outline[i - 1];
    const [x1, y1] = outline[i];
    p.quadraticCurveTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
  }
  p.closePath();
  return p;
}

export function drawStroke(ctx: CanvasRenderingContext2D, s: Stroke) {
  ctx.save();
  if (s.tool === "highlighter") {
    ctx.globalAlpha = 0.32;
    ctx.globalCompositeOperation = "multiply";
  }
  if (s.shape) {
    drawShape(ctx, s);
  } else {
    ctx.fillStyle = s.color;
    ctx.fill(strokeToPath(s));
  }
  ctx.restore();
}

/** Renders a shape stroke with plain canvas primitives — avoids the
 * self-intersecting outline geometry perfect-freehand can produce at
 * sharp corners (e.g. rectangles) when given sparse point arrays. */
function drawShape(ctx: CanvasRenderingContext2D, s: Stroke) {
  const pts = s.points;
  if (pts.length < 2) return;
  ctx.strokeStyle = s.color;
  ctx.lineWidth = s.size;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  if (s.shape === "ellipse") {
    // pts is a sampled loop of points around the ellipse perimeter
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
    ctx.stroke();
    return;
  }

  // line and rect both draw as a simple polyline through their points
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.stroke();
}

/** Axis-aligned bounds of a stroke, padded by its width. */
export function strokeBounds(s: Stroke) {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const [x, y] of s.points) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  const pad = s.size;
  return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
}

/** Does an eraser circle at (x,y) touch this stroke? */
export function hitsStroke(s: Stroke, x: number, y: number, r: number): boolean {
  const b = strokeBounds(s);
  if (x < b.minX - r || x > b.maxX + r || y < b.minY - r || y > b.maxY + r) return false;

  const rr = (r + s.size / 2) ** 2;
  const pts = s.points;
  for (let i = 0; i < pts.length; i++) {
    const [px, py] = pts[i];
    if ((px - x) ** 2 + (py - y) ** 2 <= rr) return true;
    // also test the segment, so a fast eraser swipe can't slip between samples
    if (i > 0) {
      const [ax, ay] = pts[i - 1];
      const dx = px - ax;
      const dy = py - ay;
      const len2 = dx * dx + dy * dy;
      if (len2 > 0) {
        let t = ((x - ax) * dx + (y - ay) * dy) / len2;
        t = Math.max(0, Math.min(1, t));
        const cx = ax + t * dx;
        const cy = ay + t * dy;
        if ((cx - x) ** 2 + (cy - y) ** 2 <= rr) return true;
      }
    }
  }
  return false;
}

/** Erases only the portion of a stroke within radius r of (x,y), splitting
 * the remainder into one or more new strokes (contiguous runs of surviving
 * points). Returns the replacement stroke list — empty if fully erased,
 * unchanged (same array containing s) if nothing was touched. */
export function eraseAtPoint(s: Stroke, x: number, y: number, r: number): Stroke[] {
  if (s.shape) {
    // shapes erase as a whole unit — splitting a rectangle outline into
    // partial segments would look broken, so fall back to hit-test removal
    return hitsStroke(s, x, y, r) ? [] : [s];
  }
  const rr = (r + s.size / 2) ** 2;
  const pts = s.points;
  const keep: boolean[] = pts.map(([px, py]) => (px - x) ** 2 + (py - y) ** 2 > rr);

  // also knock out points whose adjacent segment passes through the eraser,
  // so a fast swipe can't slip between sparse samples
  for (let i = 1; i < pts.length; i++) {
    if (!keep[i - 1] && !keep[i]) continue;
    const [ax, ay] = pts[i - 1];
    const [bx, by] = pts[i];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    if (len2 === 0) continue;
    let t = ((x - ax) * dx + (y - ay) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const cx = ax + t * dx;
    const cy = ay + t * dy;
    if ((cx - x) ** 2 + (cy - y) ** 2 <= rr) {
      keep[i - 1] = false;
      keep[i] = false;
    }
  }

  if (keep.every(Boolean)) return [s];
  if (keep.every((k) => !k)) return [];

  const runs: InkPoint[][] = [];
  let cur: InkPoint[] = [];
  for (let i = 0; i < pts.length; i++) {
    if (keep[i]) {
      cur.push(pts[i]);
    } else if (cur.length) {
      runs.push(cur);
      cur = [];
    }
  }
  if (cur.length) runs.push(cur);

  return runs
    .filter((run) => run.length >= 2)
    .map((run) => ({ id: uid(), tool: s.tool, color: s.color, size: s.size, points: run }));
}

export function contentHeight(strokes: Stroke[]): number {
  let max = 0;
  for (const s of strokes) {
    const b = strokeBounds(s);
    if (b.maxY > max) max = b.maxY;
  }
  return max;
}

export function uid() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
}

/** Render an ink doc to a PNG data URL — used for AI transcription. */
export function renderToPng(
  strokes: Stroke[],
  height: number,
  scale = 1
): string | null {
  if (typeof document === "undefined" || strokes.length === 0) return null;
  const c = document.createElement("canvas");
  c.width = Math.round(PAGE_W * scale);
  c.height = Math.round(height * scale);
  const ctx = c.getContext("2d");
  if (!ctx) return null;

  // white background: models read dark-on-light handwriting far better
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.scale(scale, scale);
  for (const s of strokes) drawStroke(ctx, s);
  return c.toDataURL("image/png");
}
