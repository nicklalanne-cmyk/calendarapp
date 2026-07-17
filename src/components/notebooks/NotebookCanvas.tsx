"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Pen, Highlighter, Eraser, Lasso, Undo2, Redo2, Trash2, ZoomIn, ZoomOut,
  Minus, Square, Circle, Type, ImagePlus, Plus, Copy, ClipboardPaste,
} from "lucide-react";
import clsx from "clsx";
import {
  drawStroke, hitsStroke, strokeBounds, uid, eraseAtPoint,
  HIGHLIGHTER_COLORS, HIGHLIGHTER_SIZES, PEN_COLORS, PEN_SIZES,
  type Stroke, type Tool, type ShapeKind, type InkPoint,
} from "@/lib/ink";
import { paintTemplate } from "@/lib/notebooks";
import type { NotebookPageElement, NotebookPageTemplate } from "@/lib/types";
import ColorWheel from "@/components/notebooks/ColorWheel";

type NotebookTool = Tool | "select" | "text" | "image" | `shape-${ShapeKind}`;

/** Point-in-polygon (ray casting). Used to test if a stroke's sample points
 * fall inside the lasso loop the user drew. */
function pointInPolygon(x: number, y: number, poly: [number, number][]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    const intersect =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-9) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** Turns a dragged rectangle into stroke points for the given shape kind, so
 * shapes are drawn/erased/undone exactly like freehand ink — no separate
 * shape data model needed. */
function shapePoints(kind: ShapeKind, x0: number, y0: number, x1: number, y1: number): [number, number, number][] {
  const p = 0.5;
  if (kind === "line") return [[x0, y0, p], [x1, y1, p]];
  if (kind === "rect") {
    return [[x0, y0, p], [x1, y0, p], [x1, y1, p], [x0, y1, p], [x0, y0, p]];
  }
  // ellipse: sample points around the ellipse inscribed in the bounding box
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const rx = Math.abs(x1 - x0) / 2;
  const ry = Math.abs(y1 - y0) / 2;
  const pts: [number, number, number][] = [];
  const steps = 48;
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    pts.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a), p]);
  }
  return pts;
}

function dist(ax: number, ay: number, bx: number, by: number) {
  return Math.hypot(bx - ax, by - ay);
}

export default function NotebookCanvas({
  strokes: initial,
  elements: initialElements,
  width,
  height,
  template,
  background,
  onChange,
  onElementsChange,
  onInsertImage,
  resolveImageUrl,
  readOnly,
}: {
  strokes: Stroke[];
  elements: NotebookPageElement[];
  width: number;
  height: number;
  template: NotebookPageTemplate;
  /** Pre-rendered PDF page image to paint under the strokes, if this page came from a PDF. */
  background?: HTMLCanvasElement | HTMLImageElement | null;
  onChange: (strokes: Stroke[]) => void;
  onElementsChange: (elements: NotebookPageElement[]) => void;
  /** Uploads a picked image file and returns its storage path, or null on failure. */
  onInsertImage?: (file: File) => Promise<string | null>;
  /** Resolves a stored image's storage path to a displayable URL (signed or cached). */
  resolveImageUrl: (storagePath: string) => Promise<string | null>;
  readOnly?: boolean;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const pageRef = useRef<HTMLDivElement | null>(null);
  const bgRef = useRef<HTMLCanvasElement>(null);
  const baseRef = useRef<HTMLCanvasElement>(null);
  const liveRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const strokes = useRef<Stroke[]>(initial);
  const redo = useRef<Stroke[]>([]);
  const current = useRef<Stroke | null>(null);
  const drawing = useRef(false);

  const [elements, setElements] = useState<NotebookPageElement[]>(initialElements);
  const [editingEl, setEditingEl] = useState<string | null>(null);
  const dragEl = useRef<{ id: string; startX: number; startY: number; ox: number; oy: number } | null>(null);
  const resizeEl = useRef<{ id: string; startX: number; startY: number; ow: number; oh: number } | null>(null);

  const penSeen = useRef(false);
  const [fingerDraw, setFingerDraw] = useState(false);
  const pan = useRef<{ id: number; x: number; y: number; sl: number; st: number } | null>(null);

  // pinch-to-zoom: tracks up to two simultaneous touch pointers
  const touches = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinch = useRef<{
    dist: number;
    zoom: number;
    midX: number;
    midY: number;
    sl: number;
    st: number;
    /** live target zoom for the gesture so far — only committed to React state (which
     * triggers an expensive canvas resize+redraw) once, when the gesture ends */
    liveZoom: number;
  } | null>(null);
  // during a pinch we skip React state entirely: the page div gets a CSS
  // transform applied straight to the DOM every frame (cheap, GPU-composited),
  // and canvases only get resized/redrawn once, when the gesture finishes —
  // resizing them on every touchmove was what made zoom feel laggy, and the
  // cost grows with zoom level (more backing pixels to redraw), which is why
  // it got worse the further past 100% you went.
  const pinchFrame = useRef<number | null>(null);
  const pinchPending = useRef<{ zoom: number; dx: number; dy: number } | null>(null);

  const [tool, setTool] = useState<NotebookTool>("pen");
  const [penColor, setPenColor] = useState<string>(PEN_COLORS[0]);
  const [penSize, setPenSize] = useState(PEN_SIZES[1]);
  const [hlColor, setHlColor] = useState<string>(HIGHLIGHTER_COLORS[0]);
  const [hlSize, setHlSize] = useState(HIGHLIGHTER_SIZES[1]);
  const [eraserSize, setEraserSize] = useState(18);
  const [eraseLayer, setEraseLayer] = useState<"auto" | "pen" | "highlighter">("auto");
  const [recentColors, setRecentColors] = useState<string[]>([]);
  const [zoom, setZoom] = useState(1);
  const [fitScale, setFitScale] = useState(1);
  const [, force] = useState(0);

  // lasso selection
  const lassoPoints = useRef<[number, number][]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const dragSel = useRef<{ x: number; y: number } | null>(null);
  const lassoResize = useRef<{
    startX: number;
    startY: number;
    anchorX: number;
    anchorY: number;
    startW: number;
    startH: number;
    orig: Map<string, { points: InkPoint[]; size: number }>;
  } | null>(null);

  // shape drag-to-draw
  const shapeStart = useRef<[number, number] | null>(null);

  useEffect(() => {
    strokes.current = initial;
    force((n) => n + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, height, template]);

  useEffect(() => {
    setElements(initialElements);
  }, [initialElements]);

  const scale = fitScale * zoom;

  /* ---------------- sizing ---------------- */
  useEffect(() => {
    const fit = () => {
      const w = (wrapRef.current?.clientWidth ?? width) - 16;
      setFitScale(Math.max(0.2, Math.min(1, w / width)));
    };
    fit();
    const ro = new ResizeObserver(fit);
    if (wrapRef.current) ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, [width]);

  const setupCanvas = useCallback(
    (c: HTMLCanvasElement | null) => {
      if (!c) return null;
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      c.width = Math.round(width * scale * dpr);
      c.height = Math.round(height * scale * dpr);
      c.style.width = `${width * scale}px`;
      c.style.height = `${height * scale}px`;
      const ctx = c.getContext("2d");
      if (ctx) {
        ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
      }
      return ctx;
    },
    [scale, width, height]
  );

  const redrawBg = useCallback(() => {
    const ctx = setupCanvas(bgRef.current);
    if (!ctx) return;
    if (background) {
      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(background, 0, 0, width, height);
    } else {
      paintTemplate(ctx, template, width, height);
    }
  }, [setupCanvas, background, template, width, height]);

  const redrawBase = useCallback(() => {
    const ctx = setupCanvas(baseRef.current);
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);
    for (const s of strokes.current) {
      ctx.save();
      if (selected.has(s.id)) ctx.globalAlpha = 0.55;
      drawStroke(ctx, s);
      ctx.restore();
    }
  }, [setupCanvas, width, height, selected]);

  useEffect(() => {
    redrawBg();
  }, [redrawBg]);
  useEffect(() => {
    setupCanvas(liveRef.current);
    redrawBase();
  }, [redrawBase, setupCanvas]);

  const commit = () => {
    onChange(strokes.current);
  };
  const commitElements = (next: NotebookPageElement[]) => {
    setElements(next);
    onElementsChange(next);
  };

  /* ---------------- color helpers ---------------- */
  const addCustomColor = (c: string) => {
    setRecentColors((prev) => [c, ...prev.filter((x) => x !== c)].slice(0, 6));
  };

  /* ---------------- pointer helpers ---------------- */
  const toPage = (e: PointerEvent | React.PointerEvent): [number, number] => {
    const r = liveRef.current!.getBoundingClientRect();
    return [(e.clientX - r.left) / scale, (e.clientY - r.top) / scale];
  };
  const pressureOf = (e: PointerEvent | React.PointerEvent) =>
    e.pointerType === "pen" && e.pressure > 0 ? e.pressure : 0.5;

  const shouldDraw = (e: React.PointerEvent) => {
    if (e.pointerType === "pen" || e.pointerType === "mouse") return true;
    if (penSeen.current && !fingerDraw) return false;
    return fingerDraw;
  };

  const isEraserInput = (e: React.PointerEvent) =>
    tool === "eraser" ||
    (e.pointerType === "pen" && (e.buttons & 32) !== 0) ||
    (e.pointerType === "pen" && (e.buttons & 2) !== 0);

  const eraseAt = (x: number, y: number) => {
    let targetTool: Stroke["tool"] | null;
    if (eraseLayer !== "auto") {
      // explicit layer lock — only that tool's strokes are ever touched
      targetTool = eraseLayer;
    } else {
      // layer priority: if any highlighter strokes are touched, erase only
      // those this pass (matches GoodNotes — highlight erases before ink)
      const hlHit = strokes.current.some((s) => s.tool === "highlighter" && hitsStroke(s, x, y, eraserSize));
      targetTool = hlHit ? "highlighter" : null;
    }

    let changed = false;
    const next: Stroke[] = [];
    for (const s of strokes.current) {
      if (targetTool && s.tool !== targetTool) {
        next.push(s);
        continue;
      }
      if (!hitsStroke(s, x, y, eraserSize)) {
        next.push(s);
        continue;
      }
      changed = true;
      next.push(...eraseAtPoint(s, x, y, eraserSize));
    }
    if (changed) {
      strokes.current = next;
      redrawBase();
      commit();
    }
  };

  const liveCtxRef = useRef<CanvasRenderingContext2D | null>(null);

  const drawLivePreview = (points: [number, number, number][], color: string, size: number, shape?: ShapeKind) => {
    const ctx = liveCtxRef.current;
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);
    drawStroke(ctx, { id: "preview", tool: "pen", color, size, points, shape });
  };

  const beginPinch = () => {
    const pts = [...touches.current.values()];
    if (pts.length !== 2) return;
    const [a, b] = pts;
    pinch.current = {
      dist: dist(a.x, a.y, b.x, b.y),
      zoom,
      liveZoom: zoom,
      midX: (a.x + b.x) / 2,
      midY: (a.y + b.y) / 2,
      sl: scrollRef.current?.scrollLeft ?? 0,
      st: scrollRef.current?.scrollTop ?? 0,
    };
    // cancel any in-progress stroke — two fingers down means "gesture", not "draw"
    drawing.current = false;
    current.current = null;
    const ctx = setupCanvas(liveRef.current);
    ctx?.clearRect(0, 0, width, height);
    lassoPoints.current = [];
    dragSel.current = null;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (readOnly) return;
    if (e.pointerType === "pen") penSeen.current = true;

    if (e.pointerType === "touch") {
      touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.current.size === 2) {
        beginPinch();
        return;
      }
      if (touches.current.size > 2) return;
    }

    if (e.pointerType === "touch" && !shouldDraw(e) && tool !== "select" && !tool.startsWith("shape")) {
      pan.current = {
        id: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        sl: scrollRef.current?.scrollLeft ?? 0,
        st: scrollRef.current?.scrollTop ?? 0,
      };
      return;
    }

    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    const [x, y] = toPage(e);

    if (tool === "text") {
      const el: NotebookPageElement = {
        id: uid(),
        type: "text",
        x,
        y,
        w: 220,
        h: 44,
        text: "",
        color: penColor,
        fontSize: 24,
      };
      commitElements([...elements, el]);
      setEditingEl(el.id);
      return;
    }

    if (tool.startsWith("shape")) {
      shapeStart.current = [x, y];
      liveCtxRef.current = setupCanvas(liveRef.current);
      return;
    }

    if (tool === "select") {
      if (e.pointerType === "touch") e.preventDefault();
      if (selected.size > 0) {
        // dragging starts only if the pointer comes down inside the current
        // selection's bounds — otherwise it's a fresh lasso, and this one clears.
        const sel = strokes.current.filter((s) => selected.has(s.id));
        const inBounds = sel.some((s) => {
          const b = strokeBounds(s);
          return x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY;
        });
        if (inBounds) {
          dragSel.current = { x, y };
          return;
        }
      }
      lassoPoints.current = [[x, y]];
      setSelected(new Set());
      liveCtxRef.current = setupCanvas(liveRef.current);
      return;
    }

    if (isEraserInput(e)) {
      eraseAt(x, y);
      drawing.current = true;
      return;
    }

    drawing.current = true;
    const s: Stroke = {
      id: uid(),
      tool: tool === "highlighter" ? "highlighter" : "pen",
      color: tool === "highlighter" ? hlColor : penColor,
      size: tool === "highlighter" ? hlSize : penSize,
      points: [[x, y, pressureOf(e)]],
    };
    current.current = s;
    redo.current = [];
    liveCtxRef.current = setupCanvas(liveRef.current);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (readOnly) return;

    if (e.pointerType === "touch" && touches.current.has(e.pointerId)) {
      touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.current.size === 2 && pinch.current) {
        e.preventDefault();
        const pts = [...touches.current.values()];
        const [a, b] = pts;
        const d = dist(a.x, a.y, b.x, b.y);
        const nextZoom = Math.min(4, Math.max(0.3, pinch.current.zoom * (d / pinch.current.dist)));
        const dx = (a.x + b.x) / 2 - pinch.current.midX;
        const dy = (a.y + b.y) / 2 - pinch.current.midY;
        pinchPending.current = { zoom: +nextZoom.toFixed(2), dx, dy };
        if (pinchFrame.current == null) {
          pinchFrame.current = requestAnimationFrame(() => {
            pinchFrame.current = null;
            const p = pinchPending.current;
            if (!p || !pinch.current) return;
            // live visual feedback only — a CSS transform on the page div,
            // no React state change and no canvas resize/redraw this frame
            pinch.current.liveZoom = p.zoom;
            if (pageRef.current) {
              pageRef.current.style.transform = `scale(${p.zoom / pinch.current.zoom})`;
            }
            if (scrollRef.current) {
              scrollRef.current.scrollLeft = pinch.current.sl - p.dx;
              scrollRef.current.scrollTop = pinch.current.st - p.dy;
            }
          });
        }
        return;
      }
    }

    if (pan.current && pan.current.id === e.pointerId) {
      const dx = e.clientX - pan.current.x;
      const dy = e.clientY - pan.current.y;
      if (scrollRef.current) {
        scrollRef.current.scrollLeft = pan.current.sl - dx;
        scrollRef.current.scrollTop = pan.current.st - dy;
      }
      return;
    }

    if (shapeStart.current) {
      const [x, y] = toPage(e);
      const [x0, y0] = shapeStart.current;
      const kind = tool.replace("shape-", "") as ShapeKind;
      drawLivePreview(shapePoints(kind, x0, y0, x, y), penColor, penSize, kind);
      return;
    }

    if (!drawing.current && !dragSel.current && !lassoPoints.current.length) return;
    const [x, y] = toPage(e);

    if (dragSel.current) {
      if (e.pointerType === "touch") e.preventDefault();
      const dx = x - dragSel.current.x;
      const dy = y - dragSel.current.y;
      dragSel.current = { x, y };
      strokes.current = strokes.current.map((s) =>
        selected.has(s.id)
          ? { ...s, points: s.points.map(([px, py, p]) => [px + dx, py + dy, p] as [number, number, number]) }
          : s
      );
      redrawBase();
      return;
    }

    if (tool === "select" && lassoPoints.current.length) {
      if (e.pointerType === "touch") e.preventDefault();
      lassoPoints.current.push([x, y]);
      const ctx = liveCtxRef.current;
      if (ctx) {
        ctx.clearRect(0, 0, width, height);
        ctx.save();
        ctx.strokeStyle = "#3B6FE0";
        ctx.setLineDash([6, 4]);
        ctx.lineWidth = 1.5 / scale;
        ctx.beginPath();
        lassoPoints.current.forEach(([px, py], i) =>
          i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)
        );
        ctx.stroke();
        ctx.restore();
      }
      return;
    }

    if (isEraserInput(e)) {
      eraseAt(x, y);
      return;
    }

    if (!current.current) return;
    current.current.points.push([x, y, pressureOf(e)]);
    const ctx = liveCtxRef.current;
    if (ctx) {
      ctx.clearRect(0, 0, width, height);
      drawStroke(ctx, current.current);
    }
  };

  const finishStroke = () => {
    if (current.current && current.current.points.length > 1) {
      strokes.current.push(current.current);
      commit();
    }
    current.current = null;
    const ctx = setupCanvas(liveRef.current);
    ctx?.clearRect(0, 0, width, height);
    redrawBase();
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (e.pointerType === "touch") {
      touches.current.delete(e.pointerId);
      if (touches.current.size < 2 && pinch.current) {
        if (pinchFrame.current != null) {
          cancelAnimationFrame(pinchFrame.current);
          pinchFrame.current = null;
        }
        // commit the gesture's final zoom now — this is the only point during
        // a pinch that actually resizes/redraws the canvases
        if (pageRef.current) pageRef.current.style.transform = "";
        if (pinch.current.liveZoom !== pinch.current.zoom) setZoom(pinch.current.liveZoom);
        pinch.current = null;
      }
      if (touches.current.size > 0) return;
    }

    if (pan.current?.id === e.pointerId) {
      pan.current = null;
      return;
    }

    if (shapeStart.current) {
      const [x, y] = toPage(e);
      const [x0, y0] = shapeStart.current;
      shapeStart.current = null;
      const kind = tool.replace("shape-", "") as ShapeKind;
      const points = shapePoints(kind, x0, y0, x, y);
      if (dist(x0, y0, x, y) > 3) {
        strokes.current.push({ id: uid(), tool: "pen", color: penColor, size: penSize, points, shape: kind });
        commit();
      }
      const ctx = setupCanvas(liveRef.current);
      ctx?.clearRect(0, 0, width, height);
      redrawBase();
      return;
    }

    if (dragSel.current) {
      dragSel.current = null;
      commit();
      return;
    }
    if (tool === "select" && lassoPoints.current.length > 1) {
      const poly = lassoPoints.current;
      const hit = new Set<string>();
      for (const s of strokes.current) {
        if (s.points.some(([px, py]) => pointInPolygon(px, py, poly))) hit.add(s.id);
      }
      setSelected(hit);
      lassoPoints.current = [];
      const ctx = setupCanvas(liveRef.current);
      ctx?.clearRect(0, 0, width, height);
      return;
    }
    if (drawing.current) {
      drawing.current = false;
      finishStroke();
    }
  };

  const deleteSelected = () => {
    if (selected.size === 0) return;
    strokes.current = strokes.current.filter((s) => !selected.has(s.id));
    setSelected(new Set());
    redrawBase();
    commit();
  };

  /* ---------------- copy / paste ---------------- */
  const clipboard = useRef<Stroke[]>([]);
  const copySelected = () => {
    if (selected.size === 0) return;
    clipboard.current = strokes.current
      .filter((s) => selected.has(s.id))
      .map((s) => ({ ...s, points: s.points.map((p) => [...p] as InkPoint) }));
    force((n) => n + 1);
  };
  const pasteClipboard = () => {
    if (clipboard.current.length === 0) return;
    const OFFSET = 24;
    const pasted = clipboard.current.map((s) => ({
      ...s,
      id: uid(),
      points: s.points.map(([px, py, p]) => [px + OFFSET, py + OFFSET, p] as InkPoint),
    }));
    strokes.current = [...strokes.current, ...pasted];
    setSelected(new Set(pasted.map((s) => s.id)));
    redrawBase();
    commit();
    // so a second paste offsets further rather than landing on top of the first
    clipboard.current = pasted.map((s) => ({ ...s, points: s.points.map((p) => [...p] as InkPoint) }));
  };

  useEffect(() => {
    if (readOnly) return;
    const onKey = (e: KeyboardEvent) => {
      if (tool !== "select") return;
      const meta = e.metaKey || e.ctrlKey;
      if (!meta) return;
      if (e.key === "c") copySelected();
      else if (e.key === "v") pasteClipboard();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool, selected]);

  // Paste an image from the OS clipboard (screenshot, copied image, etc.)
  // straight onto the page — separate from the ink-stroke clipboard above,
  // which only handles copy/paste of selected strokes and is gated to the
  // select tool. Image paste should work regardless of which tool is active.
  useEffect(() => {
    if (readOnly || !onInsertImage) return;
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of Array.from(items)) {
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) {
            e.preventDefault();
            onImageChosen(file);
          }
          break;
        }
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readOnly, onInsertImage, elements]);

  /* ---------------- lasso resize (scale selected strokes from a corner handle) ---------------- */
  const selectionBounds = () => {
    const sel = strokes.current.filter((s) => selected.has(s.id));
    if (!sel.length) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const s of sel) {
      const b = strokeBounds(s);
      if (b.minX < minX) minX = b.minX;
      if (b.minY < minY) minY = b.minY;
      if (b.maxX > maxX) maxX = b.maxX;
      if (b.maxY > maxY) maxY = b.maxY;
    }
    return { minX, minY, maxX, maxY };
  };

  const startLassoResize = (e: React.PointerEvent) => {
    const b = selectionBounds();
    if (!b) return;
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    const orig = new Map<string, { points: InkPoint[]; size: number }>();
    for (const s of strokes.current) {
      if (selected.has(s.id)) orig.set(s.id, { points: s.points.map((p) => [...p] as InkPoint), size: s.size });
    }
    lassoResize.current = {
      startX: e.clientX,
      startY: e.clientY,
      anchorX: b.minX,
      anchorY: b.minY,
      startW: Math.max(1, b.maxX - b.minX),
      startH: Math.max(1, b.maxY - b.minY),
      orig,
    };
  };
  const onLassoResizeMove = (e: React.PointerEvent) => {
    const rz = lassoResize.current;
    if (!rz) return;
    const dx = (e.clientX - rz.startX) / scale;
    const dy = (e.clientY - rz.startY) / scale;
    const sx = Math.max(0.1, (rz.startW + dx) / rz.startW);
    const sy = Math.max(0.1, (rz.startH + dy) / rz.startH);
    const g = Math.sqrt(sx * sy);
    strokes.current = strokes.current.map((s) => {
      const o = rz.orig.get(s.id);
      if (!o) return s;
      return {
        ...s,
        points: o.points.map(([px, py, p]) => [rz.anchorX + (px - rz.anchorX) * sx, rz.anchorY + (py - rz.anchorY) * sy, p] as InkPoint),
        size: Math.max(1, o.size * g),
      };
    });
    redrawBase();
    force((n) => n + 1);
  };
  const endLassoResize = () => {
    if (lassoResize.current) {
      lassoResize.current = null;
      commit();
    }
  };

  const undo = () => {
    const s = strokes.current.pop();
    if (s) {
      redo.current.push(s);
      redrawBase();
      commit();
    }
  };
  const redoLast = () => {
    const s = redo.current.pop();
    if (s) {
      strokes.current.push(s);
      redrawBase();
      commit();
    }
  };

  useEffect(() => {
    redrawBase();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  /* ---------------- elements (text/image) ---------------- */
  const updateElement = (id: string, patch: Partial<NotebookPageElement>) => {
    commitElements(elements.map((el) => (el.id === id ? ({ ...el, ...patch } as NotebookPageElement) : el)));
  };
  const deleteElement = (id: string) => {
    commitElements(elements.filter((el) => el.id !== id));
    if (editingEl === id) setEditingEl(null);
  };

  const pickImage = () => fileRef.current?.click();
  const onImageChosen = async (file: File) => {
    if (!onInsertImage) return;
    const path = await onInsertImage(file);
    if (!path) return;
    const img = new Image();
    img.onload = () => {
      const maxW = width * 0.6;
      const ratio = img.naturalWidth ? img.naturalHeight / img.naturalWidth : 1;
      const w = Math.min(maxW, img.naturalWidth || maxW);
      const h = w * ratio;
      const el: NotebookPageElement = {
        id: uid(),
        type: "image",
        x: width / 2 - w / 2,
        y: height / 2 - h / 2,
        w,
        h,
        storagePath: path,
      };
      commitElements([...elements, el]);
    };
    const url = await resolveImageUrl(path);
    if (url) img.src = url;
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {!readOnly && (
        <div className="flex flex-wrap items-center gap-1 border-b border-border px-2 py-1.5">
          <ToolBtn active={tool === "pen"} onClick={() => setTool("pen")} label="Pen">
            <Pen className="h-4 w-4" />
          </ToolBtn>
          <ToolBtn active={tool === "highlighter"} onClick={() => setTool("highlighter")} label="Highlighter">
            <Highlighter className="h-4 w-4" />
          </ToolBtn>
          <ToolBtn active={tool === "eraser"} onClick={() => setTool("eraser")} label="Eraser">
            <Eraser className="h-4 w-4" />
          </ToolBtn>
          <ToolBtn active={tool === "select"} onClick={() => setTool("select")} label="Select / lasso">
            <Lasso className="h-4 w-4" />
          </ToolBtn>

          <div className="mx-1 h-5 w-px bg-border" />

          <ToolBtn active={tool === "shape-line"} onClick={() => setTool("shape-line")} label="Line">
            <Minus className="h-4 w-4" />
          </ToolBtn>
          <ToolBtn active={tool === "shape-rect"} onClick={() => setTool("shape-rect")} label="Rectangle">
            <Square className="h-4 w-4" />
          </ToolBtn>
          <ToolBtn active={tool === "shape-ellipse"} onClick={() => setTool("shape-ellipse")} label="Ellipse">
            <Circle className="h-4 w-4" />
          </ToolBtn>
          <ToolBtn active={tool === "text"} onClick={() => setTool("text")} label="Text box">
            <Type className="h-4 w-4" />
          </ToolBtn>
          {onInsertImage && (
            <ToolBtn active={false} onClick={pickImage} label="Insert image">
              <ImagePlus className="h-4 w-4" />
            </ToolBtn>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && onImageChosen(e.target.files[0])}
          />

          <div className="mx-1 h-5 w-px bg-border" />

          {tool === "pen" && (
            <>
              {PEN_COLORS.map((c) => (
                <Swatch key={c} color={c} active={c === penColor} onClick={() => setPenColor(c)} />
              ))}
              <CustomColorSwatch onPick={(c) => { setPenColor(c); addCustomColor(c); }} />
              <ColorWheel onPick={(c) => { setPenColor(c); addCustomColor(c); }} />
              {recentColors.map((c) => (
                <Swatch key={c} color={c} active={c === penColor} onClick={() => setPenColor(c)} />
              ))}
              <SizePicker sizes={PEN_SIZES} value={penSize} onChange={setPenSize} />
            </>
          )}
          {tool === "highlighter" && (
            <>
              {HIGHLIGHTER_COLORS.map((c) => (
                <Swatch key={c} color={c} active={c === hlColor} onClick={() => setHlColor(c)} />
              ))}
              <CustomColorSwatch onPick={(c) => { setHlColor(c); addCustomColor(c); }} />
              <ColorWheel onPick={(c) => { setHlColor(c); addCustomColor(c); }} />
              <SizePicker sizes={HIGHLIGHTER_SIZES} value={hlSize} onChange={setHlSize} />
            </>
          )}
          {tool === "eraser" && (
            <>
              <SizePicker sizes={[12, 18, 30]} value={eraserSize} onChange={setEraserSize} />
              <div className="ml-1 flex overflow-hidden rounded-md border border-border text-xs">
                {(
                  [
                    ["auto", "Auto"],
                    ["highlighter", "Highlight"],
                    ["pen", "Pen"],
                  ] as const
                ).map(([v, label]) => (
                  <button
                    key={v}
                    onClick={() => setEraseLayer(v)}
                    title="Which layer the eraser removes"
                    className={clsx(
                      "px-2 py-1",
                      eraseLayer === v ? "bg-accent font-medium text-white" : "text-txt2 hover:bg-surface2"
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </>
          )}
          {tool.startsWith("shape") && (
            <>
              {PEN_COLORS.map((c) => (
                <Swatch key={c} color={c} active={c === penColor} onClick={() => setPenColor(c)} />
              ))}
              <ColorWheel onPick={(c) => { setPenColor(c); addCustomColor(c); }} />
              <SizePicker sizes={PEN_SIZES} value={penSize} onChange={setPenSize} />
            </>
          )}
          {tool === "select" && selected.size > 0 && (
            <>
              <button
                onClick={copySelected}
                title="Copy (⌘/Ctrl+C)"
                className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-txt2 hover:bg-surface2"
              >
                <Copy className="h-3.5 w-3.5" /> Copy
              </button>
              <button
                onClick={deleteSelected}
                className="flex items-center gap-1 rounded-md bg-danger/10 px-2 py-1 text-xs font-medium text-danger hover:bg-danger/20"
              >
                <Trash2 className="h-3.5 w-3.5" /> Delete {selected.size}
              </button>
            </>
          )}
          {tool === "select" && clipboard.current.length > 0 && (
            <button
              onClick={pasteClipboard}
              title="Paste (⌘/Ctrl+V)"
              className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-txt2 hover:bg-surface2"
            >
              <ClipboardPaste className="h-3.5 w-3.5" /> Paste
            </button>
          )}

          <div className="ml-auto flex items-center gap-1">
            <button onClick={undo} className="rounded-md p-1.5 text-txt3 hover:bg-surface2" title="Undo">
              <Undo2 className="h-4 w-4" />
            </button>
            <button onClick={redoLast} className="rounded-md p-1.5 text-txt3 hover:bg-surface2" title="Redo">
              <Redo2 className="h-4 w-4" />
            </button>
            <div className="mx-1 h-5 w-px bg-border" />
            <button
              onClick={() => setZoom((z) => Math.max(0.3, +(z - 0.2).toFixed(2)))}
              className="rounded-md p-1.5 text-txt3 hover:bg-surface2"
              title="Zoom out"
            >
              <ZoomOut className="h-4 w-4" />
            </button>
            <span className="w-10 text-center text-xs text-txt3">{Math.round(zoom * 100)}%</span>
            <button
              onClick={() => setZoom((z) => Math.min(4, +(z + 0.2).toFixed(2)))}
              className="rounded-md p-1.5 text-txt3 hover:bg-surface2"
              title="Zoom in"
            >
              <ZoomIn className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      <div ref={wrapRef} className="min-h-0 flex-1 overflow-hidden bg-surface2">
        <div ref={scrollRef} className="h-full w-full overflow-auto" style={{ touchAction: "none" }}>
          <div
            ref={pageRef}
            className="relative mx-auto my-4 shadow-md"
            style={{ width: width * scale, height: height * scale, transformOrigin: "0 0" }}
          >
            <canvas ref={bgRef} className="absolute inset-0 rounded-sm" />
            <canvas ref={baseRef} className="absolute inset-0" />
            <canvas
              ref={liveRef}
              className={clsx(
                "absolute inset-0",
                !readOnly && (tool === "select" ? "cursor-crosshair" : "touch-none")
              )}
              style={{ touchAction: "none" }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            />

            {elements.map((el) => (
              <PageElementView
                key={el.id}
                el={el}
                scale={scale}
                readOnly={readOnly}
                editing={editingEl === el.id}
                resolveImageUrl={resolveImageUrl}
                onStartEdit={() => setEditingEl(el.id)}
                onStopEdit={() => setEditingEl(null)}
                onChange={(patch) => updateElement(el.id, patch)}
                onDelete={() => deleteElement(el.id)}
                dragRef={dragEl}
                resizeRef={resizeEl}
              />
            ))}

            {!readOnly && tool === "select" && selected.size > 0 && (() => {
              const b = selectionBounds();
              if (!b) return null;
              return (
                <div
                  className="pointer-events-none absolute border border-dashed border-accent"
                  style={{
                    left: b.minX * scale,
                    top: b.minY * scale,
                    width: (b.maxX - b.minX) * scale,
                    height: (b.maxY - b.minY) * scale,
                  }}
                >
                  <div
                    onPointerDown={startLassoResize}
                    onPointerMove={onLassoResizeMove}
                    onPointerUp={endLassoResize}
                    onPointerCancel={endLassoResize}
                    title="Resize selection"
                    className="pointer-events-auto absolute -bottom-1.5 -right-1.5 h-4 w-4 cursor-nwse-resize rounded-full border-2 border-accent bg-white"
                  />
                </div>
              );
            })()}
          </div>
        </div>
      </div>

      {!readOnly && (
        <div className="flex items-center justify-center gap-2 border-t border-border px-2 py-1 text-[11px] text-txt3 md:hidden">
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={fingerDraw}
              onChange={(e) => setFingerDraw(e.target.checked)}
            />
            Draw with finger — pinch with two fingers to zoom
          </label>
        </div>
      )}
    </div>
  );
}

function PageElementView({
  el,
  scale,
  readOnly,
  editing,
  resolveImageUrl,
  onStartEdit,
  onStopEdit,
  onChange,
  onDelete,
  dragRef,
  resizeRef,
}: {
  el: NotebookPageElement;
  scale: number;
  readOnly?: boolean;
  editing: boolean;
  resolveImageUrl: (path: string) => Promise<string | null>;
  onStartEdit: () => void;
  onStopEdit: () => void;
  onChange: (patch: Partial<NotebookPageElement>) => void;
  onDelete: () => void;
  dragRef: React.MutableRefObject<{ id: string; startX: number; startY: number; ox: number; oy: number } | null>;
  resizeRef: React.MutableRefObject<{ id: string; startX: number; startY: number; ow: number; oh: number } | null>;
}) {
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [hover, setHover] = useState(false);

  useEffect(() => {
    if (el.type === "image") {
      let cancelled = false;
      resolveImageUrl(el.storagePath).then((u) => !cancelled && setImgUrl(u));
      return () => {
        cancelled = true;
      };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [el.type === "image" ? el.storagePath : null]);

  const startDrag = (e: React.PointerEvent) => {
    if (readOnly || editing) return;
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    dragRef.current = { id: el.id, startX: e.clientX, startY: e.clientY, ox: el.x, oy: el.y };
  };
  const onDrag = (e: React.PointerEvent) => {
    if (!dragRef.current || dragRef.current.id !== el.id) return;
    const dx = (e.clientX - dragRef.current.startX) / scale;
    const dy = (e.clientY - dragRef.current.startY) / scale;
    onChange({ x: dragRef.current.ox + dx, y: dragRef.current.oy + dy });
  };
  const endDrag = () => {
    dragRef.current = null;
  };

  const startResize = (e: React.PointerEvent) => {
    if (readOnly) return;
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    resizeRef.current = { id: el.id, startX: e.clientX, startY: e.clientY, ow: el.w, oh: el.h };
  };
  const onResize = (e: React.PointerEvent) => {
    if (!resizeRef.current || resizeRef.current.id !== el.id) return;
    const dx = (e.clientX - resizeRef.current.startX) / scale;
    const dy = (e.clientY - resizeRef.current.startY) / scale;
    onChange({
      w: Math.max(30, resizeRef.current.ow + dx),
      h: Math.max(20, resizeRef.current.oh + dy),
    });
  };
  const endResize = () => {
    resizeRef.current = null;
  };

  return (
    <div
      className={clsx(
        "absolute",
        !readOnly && !editing && "cursor-move",
        !readOnly && hover && "outline outline-1 outline-accent/60"
      )}
      style={{ left: el.x * scale, top: el.y * scale, width: el.w * scale, height: el.h * scale }}
      onPointerDown={startDrag}
      onPointerMove={onDrag}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onDoubleClick={() => el.type === "text" && onStartEdit()}
    >
      {el.type === "text" &&
        (editing ? (
          <textarea
            autoFocus
            defaultValue={el.text}
            onBlur={(e) => {
              const text = e.target.value;
              onStopEdit();
              if (!text.trim()) onDelete();
              else onChange({ text });
            }}
            style={{ fontSize: el.fontSize * scale, color: el.color, lineHeight: 1.3 }}
            className="h-full w-full resize-none bg-white/80 p-1 outline outline-2 outline-accent"
          />
        ) : (
          <div
            style={{ fontSize: el.fontSize * scale, color: el.color, lineHeight: 1.3 }}
            className="h-full w-full whitespace-pre-wrap break-words p-1"
          >
            {el.text || <span className="italic text-txt3">Empty text</span>}
          </div>
        ))}

      {el.type === "image" &&
        (imgUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imgUrl} alt="" className="h-full w-full select-none object-contain" draggable={false} />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-surface2 text-xs text-txt3">
            Loading…
          </div>
        ))}

      {!readOnly && hover && (
        <>
          <button
            onPointerDown={(e) => e.stopPropagation()}
            onClick={onDelete}
            className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full bg-danger text-white shadow"
          >
            ×
          </button>
          <div
            onPointerDown={startResize}
            onPointerMove={onResize}
            onPointerUp={endResize}
            onPointerCancel={endResize}
            className="absolute -bottom-1.5 -right-1.5 h-4 w-4 cursor-nwse-resize rounded-full border-2 border-accent bg-white"
          />
        </>
      )}
    </div>
  );
}

function ToolBtn({
  active,
  onClick,
  label,
  children,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      className={clsx(
        "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition",
        active ? "bg-accent text-white" : "text-txt2 hover:bg-surface2"
      )}
    >
      {children}
    </button>
  );
}

function Swatch({ color, active, onClick }: { color: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        "h-6 w-6 shrink-0 rounded-full border-2 transition",
        active ? "border-txt scale-110" : "border-transparent"
      )}
      style={{ background: color }}
    />
  );
}

function CustomColorSwatch({ onPick }: { onPick: (color: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        onClick={() => ref.current?.click()}
        title="Custom color"
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-dashed border-txt3 text-txt3"
      >
        <Plus className="h-3 w-3" />
      </button>
      <input
        ref={ref}
        type="color"
        className="h-0 w-0 opacity-0"
        onChange={(e) => onPick(e.target.value)}
      />
    </>
  );
}

function SizePicker({
  sizes,
  value,
  onChange,
}: {
  sizes: number[];
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className="flex items-center gap-0.5">
      {sizes.map((s) => (
        <button
          key={s}
          onClick={() => onChange(s)}
          className={clsx(
            "flex h-8 w-8 items-center justify-center rounded-lg",
            value === s ? "bg-surface2" : "hover:bg-surface2"
          )}
        >
          <span
            className="rounded-full bg-txt2"
            style={{ width: Math.min(16, 4 + s / 3), height: Math.min(16, 4 + s / 3) }}
          />
        </button>
      ))}
    </div>
  );
}
