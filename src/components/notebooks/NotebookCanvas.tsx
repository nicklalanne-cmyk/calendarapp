"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Pen, Highlighter, Eraser, Lasso, Undo2, Redo2, Trash2, ZoomIn, ZoomOut,
} from "lucide-react";
import clsx from "clsx";
import {
  drawStroke, hitsStroke, strokeBounds, uid,
  HIGHLIGHTER_COLORS, HIGHLIGHTER_SIZES, PEN_COLORS, PEN_SIZES,
  type Stroke, type Tool,
} from "@/lib/ink";
import { paintTemplate } from "@/lib/notebooks";
import type { NotebookPageTemplate } from "@/lib/types";

type SelectTool = Tool | "select";

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

export default function NotebookCanvas({
  strokes: initial,
  width,
  height,
  template,
  background,
  onChange,
  readOnly,
}: {
  strokes: Stroke[];
  width: number;
  height: number;
  template: NotebookPageTemplate;
  /** Pre-rendered PDF page image to paint under the strokes, if this page came from a PDF. */
  background?: HTMLCanvasElement | HTMLImageElement | null;
  onChange: (strokes: Stroke[]) => void;
  readOnly?: boolean;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const bgRef = useRef<HTMLCanvasElement>(null);
  const baseRef = useRef<HTMLCanvasElement>(null);
  const liveRef = useRef<HTMLCanvasElement>(null);

  const strokes = useRef<Stroke[]>(initial);
  const redo = useRef<Stroke[]>([]);
  const current = useRef<Stroke | null>(null);
  const drawing = useRef(false);
  const changed = useRef(false);

  const penSeen = useRef(false);
  const [fingerDraw, setFingerDraw] = useState(false);
  const pan = useRef<{ id: number; x: number; y: number; sl: number; st: number } | null>(null);

  const [tool, setTool] = useState<SelectTool>("pen");
  const [penColor, setPenColor] = useState(PEN_COLORS[0]);
  const [penSize, setPenSize] = useState(PEN_SIZES[1]);
  const [hlColor, setHlColor] = useState(HIGHLIGHTER_COLORS[0]);
  const [hlSize, setHlSize] = useState(HIGHLIGHTER_SIZES[1]);
  const [eraserSize, setEraserSize] = useState(18);
  const [zoom, setZoom] = useState(1);
  const [fitScale, setFitScale] = useState(1);
  const [, force] = useState(0);

  // lasso selection
  const lassoPoints = useRef<[number, number][]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const dragSel = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    strokes.current = initial;
    force((n) => n + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, height, template]);

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
    changed.current = true;
    onChange(strokes.current);
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
    const before = strokes.current.length;
    strokes.current = strokes.current.filter((s) => !hitsStroke(s, x, y, eraserSize));
    if (strokes.current.length !== before) {
      redrawBase();
      commit();
    }
  };

  const liveCtxRef = useRef<CanvasRenderingContext2D | null>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    if (readOnly) return;
    if (e.pointerType === "pen") penSeen.current = true;

    if (e.pointerType === "touch" && !shouldDraw(e) && tool !== "select") {
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

    if (tool === "select") {
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

    if (pan.current && pan.current.id === e.pointerId) {
      const dx = e.clientX - pan.current.x;
      const dy = e.clientY - pan.current.y;
      if (scrollRef.current) {
        scrollRef.current.scrollLeft = pan.current.sl - dx;
        scrollRef.current.scrollTop = pan.current.st - dy;
      }
      return;
    }

    if (!drawing.current && !dragSel.current && !lassoPoints.current.length) return;
    const [x, y] = toPage(e);

    if (dragSel.current) {
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
      lassoPoints.current.push([x, y]);
      const ctx = setupCanvas(liveRef.current);
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
    if (pan.current?.id === e.pointerId) {
      pan.current = null;
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

          {tool === "pen" && (
            <>
              {PEN_COLORS.map((c) => (
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
              <SizePicker sizes={HIGHLIGHTER_SIZES} value={hlSize} onChange={setHlSize} />
            </>
          )}
          {tool === "eraser" && (
            <SizePicker sizes={[12, 18, 30]} value={eraserSize} onChange={setEraserSize} />
          )}
          {tool === "select" && selected.size > 0 && (
            <button
              onClick={deleteSelected}
              className="flex items-center gap-1 rounded-md bg-danger/10 px-2 py-1 text-xs font-medium text-danger hover:bg-danger/20"
            >
              <Trash2 className="h-3.5 w-3.5" /> Delete {selected.size}
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
              onClick={() => setZoom((z) => Math.max(0.4, +(z - 0.2).toFixed(2)))}
              className="rounded-md p-1.5 text-txt3 hover:bg-surface2"
              title="Zoom out"
            >
              <ZoomOut className="h-4 w-4" />
            </button>
            <span className="w-10 text-center text-xs text-txt3">{Math.round(zoom * 100)}%</span>
            <button
              onClick={() => setZoom((z) => Math.min(3, +(z + 0.2).toFixed(2)))}
              className="rounded-md p-1.5 text-txt3 hover:bg-surface2"
              title="Zoom in"
            >
              <ZoomIn className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      <div ref={wrapRef} className="min-h-0 flex-1 overflow-hidden bg-surface2">
        <div ref={scrollRef} className="h-full w-full overflow-auto">
          <div
            className="relative mx-auto my-4 shadow-md"
            style={{ width: width * scale, height: height * scale }}
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
            Draw with finger
          </label>
        </div>
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
        "flex h-8 w-8 items-center justify-center rounded-lg transition",
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
