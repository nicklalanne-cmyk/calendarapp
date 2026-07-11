"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Pen, Highlighter, Eraser, Undo2, Redo2, Trash2, Hand, Sparkles, Loader2, Check,
} from "lucide-react";
import clsx from "clsx";
import {
  contentHeight, drawStroke, hitsStroke, uid,
  HIGHLIGHTER_COLORS, HIGHLIGHTER_SIZES, PAGE_GROW, PAGE_START_H, PAGE_W,
  PEN_COLORS, PEN_SIZES,
  type InkPoint, type Stroke, type Tool,
} from "@/lib/ink";

export default function InkCanvas({
  initial,
  initialHeight,
  onChange,
  onTranscribe,
  transcribing,
}: {
  initial: Stroke[];
  initialHeight: number | null;
  onChange: (strokes: Stroke[], height: number) => void;
  onTranscribe: (strokes: Stroke[], height: number) => void;
  transcribing?: boolean;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const baseRef = useRef<HTMLCanvasElement>(null); // committed strokes
  const liveRef = useRef<HTMLCanvasElement>(null); // the stroke in progress

  const strokes = useRef<Stroke[]>(initial);
  const redo = useRef<Stroke[]>([]);
  const current = useRef<Stroke | null>(null);
  const drawing = useRef(false);
  const erased = useRef(false);

  // Palm rejection: once we've seen a real pen, touch stops drawing and is
  // used only for scrolling. Without this, your hand resting on a Tab S10 draws.
  const penSeen = useRef(false);
  const [fingerDraw, setFingerDraw] = useState(false);

  const [tool, setTool] = useState<Tool>("pen");
  const [penColor, setPenColor] = useState(PEN_COLORS[0]);
  const [penSize, setPenSize] = useState(PEN_SIZES[1]);
  const [hlColor, setHlColor] = useState(HIGHLIGHTER_COLORS[0]);
  const [hlSize, setHlSize] = useState(HIGHLIGHTER_SIZES[1]);
  const [eraserSize, setEraserSize] = useState(18);
  const [height, setHeight] = useState(
    Math.max(initialHeight ?? PAGE_START_H, PAGE_START_H)
  );
  const [scale, setScale] = useState(1);
  const [, force] = useState(0);

  /* ---------------- sizing ---------------- */

  useEffect(() => {
    const fit = () => {
      const w = wrapRef.current?.clientWidth ?? PAGE_W;
      setScale(Math.min(1, w / PAGE_W));
    };
    fit();
    const ro = new ResizeObserver(fit);
    if (wrapRef.current) ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  const setupCanvas = useCallback(
    (c: HTMLCanvasElement | null) => {
      if (!c) return null;
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      c.width = Math.round(PAGE_W * scale * dpr);
      c.height = Math.round(height * scale * dpr);
      c.style.width = `${PAGE_W * scale}px`;
      c.style.height = `${height * scale}px`;
      const ctx = c.getContext("2d");
      if (ctx) {
        ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
      }
      return ctx;
    },
    [scale, height]
  );

  const redrawBase = useCallback(() => {
    const ctx = setupCanvas(baseRef.current);
    if (!ctx) return;
    ctx.clearRect(0, 0, PAGE_W, height);
    for (const s of strokes.current) drawStroke(ctx, s);
  }, [setupCanvas, height]);

  useEffect(() => {
    setupCanvas(liveRef.current);
    redrawBase();
  }, [redrawBase, setupCanvas]);

  /* ---------------- input ---------------- */

  const toPage = (e: PointerEvent | React.PointerEvent): [number, number] => {
    const r = liveRef.current!.getBoundingClientRect();
    return [(e.clientX - r.left) / scale, (e.clientY - r.top) / scale];
  };

  const pressureOf = (e: PointerEvent | React.PointerEvent) => {
    // Chrome reports 0.5 for mouse and 0 on some synthetic events
    if (e.pointerType === "pen" && e.pressure > 0) return e.pressure;
    return 0.5;
  };

  const shouldDraw = (e: React.PointerEvent) => {
    if (e.pointerType === "pen") return true;
    if (e.pointerType === "mouse") return true;
    // touch
    if (penSeen.current && !fingerDraw) return false; // palm / scroll
    return fingerDraw;
  };

  // S Pen: flipping to the eraser end, or holding the barrel button, erases.
  const isEraserInput = (e: React.PointerEvent) =>
    tool === "eraser" ||
    (e.pointerType === "pen" && (e.buttons & 32) !== 0) ||
    (e.pointerType === "pen" && (e.buttons & 2) !== 0);

  const eraseAt = (x: number, y: number) => {
    const before = strokes.current.length;
    strokes.current = strokes.current.filter((s) => !hitsStroke(s, x, y, eraserSize));
    if (strokes.current.length !== before) {
      erased.current = true;
      redrawBase();
    }
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === "pen") penSeen.current = true;
    if (!shouldDraw(e)) return;

    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drawing.current = true;
    redo.current = [];

    const [x, y] = toPage(e);

    if (isEraserInput(e)) {
      erased.current = false;
      eraseAt(x, y);
      current.current = null;
      return;
    }

    const isHl = tool === "highlighter";
    current.current = {
      id: uid(),
      tool: isHl ? "highlighter" : "pen",
      color: isHl ? hlColor : penColor,
      size: isHl ? hlSize : penSize,
      points: [[x, y, pressureOf(e)]],
    };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drawing.current) return;
    e.preventDefault();

    // High-frequency samples between frames — this is what makes the S Pen
    // feel smooth instead of polygonal.
    const evs: (PointerEvent | React.PointerEvent)[] =
      typeof e.nativeEvent.getCoalescedEvents === "function"
        ? e.nativeEvent.getCoalescedEvents()
        : [e];

    if (!current.current) {
      for (const ev of evs) {
        const [x, y] = toPage(ev);
        eraseAt(x, y);
      }
      return;
    }

    for (const ev of evs) {
      const [x, y] = toPage(ev);
      current.current.points.push([x, y, pressureOf(ev)]);
    }

    const ctx = liveRef.current?.getContext("2d");
    if (ctx) {
      ctx.clearRect(0, 0, PAGE_W, height);
      drawStroke(ctx, current.current);
    }
  };

  const commit = () => {
    if (!drawing.current) return;
    drawing.current = false;

    const s = current.current;
    current.current = null;

    const ctx = liveRef.current?.getContext("2d");
    ctx?.clearRect(0, 0, PAGE_W, height);

    if (s && s.points.length > 1) {
      strokes.current = [...strokes.current, s];
      const base = baseRef.current?.getContext("2d");
      if (base) drawStroke(base, s);
    } else if (!s && !erased.current) {
      return; // eraser touched nothing
    }

    grow();
    push();
    force((n) => n + 1);
  };

  /** Extend the page when writing approaches the bottom. */
  const grow = () => {
    const h = contentHeight(strokes.current);
    if (h > height - 260) setHeight(Math.ceil((h + PAGE_GROW) / 100) * 100);
  };

  const push = () => onChange(strokes.current, height);

  const undo = () => {
    const s = strokes.current[strokes.current.length - 1];
    if (!s) return;
    redo.current = [...redo.current, s];
    strokes.current = strokes.current.slice(0, -1);
    redrawBase();
    push();
    force((n) => n + 1);
  };

  const redoFn = () => {
    const s = redo.current[redo.current.length - 1];
    if (!s) return;
    redo.current = redo.current.slice(0, -1);
    strokes.current = [...strokes.current, s];
    redrawBase();
    push();
    force((n) => n + 1);
  };

  const clearAll = () => {
    if (strokes.current.length === 0) return;
    redo.current = [...strokes.current].reverse();
    strokes.current = [];
    redrawBase();
    push();
    force((n) => n + 1);
  };

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key.toLowerCase() === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((e.key.toLowerCase() === "z" && e.shiftKey) || e.key.toLowerCase() === "y") {
        e.preventDefault();
        redoFn();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });

  const colors = tool === "highlighter" ? HIGHLIGHTER_COLORS : PEN_COLORS;
  const sizes =
    tool === "highlighter" ? HIGHLIGHTER_SIZES : tool === "eraser" ? [10, 18, 32] : PEN_SIZES;
  const activeColor = tool === "highlighter" ? hlColor : penColor;
  const activeSize = tool === "highlighter" ? hlSize : tool === "eraser" ? eraserSize : penSize;

  const setSize = (n: number) =>
    tool === "highlighter" ? setHlSize(n) : tool === "eraser" ? setEraserSize(n) : setPenSize(n);
  const setColor = (c: string) => (tool === "highlighter" ? setHlColor(c) : setPenColor(c));

  const Tools: { id: Tool; icon: React.ElementType; label: string }[] = [
    { id: "pen", icon: Pen, label: "Pen" },
    { id: "highlighter", icon: Highlighter, label: "Highlighter" },
    { id: "eraser", icon: Eraser, label: "Eraser" },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* toolbar */}
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-border px-2 py-2">
        <div className="flex items-center gap-0.5 rounded-xl bg-surface2 p-0.5">
          {Tools.map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                onClick={() => setTool(t.id)}
                title={t.label}
                className={clsx(
                  "flex h-10 w-10 items-center justify-center rounded-lg transition",
                  tool === t.id ? "bg-surface text-accent shadow-sm" : "text-txt3 active:bg-surface"
                )}
              >
                <Icon className="h-[18px] w-[18px]" />
              </button>
            );
          })}
        </div>

        {tool !== "eraser" && (
          <div className="flex items-center gap-1">
            {colors.map((c) => (
              <button
                key={c}
                onClick={() => setColor(c)}
                className={clsx(
                  "h-7 w-7 rounded-full border-2 transition",
                  activeColor === c ? "border-accent scale-110" : "border-transparent"
                )}
                style={{ background: c }}
                aria-label={`Colour ${c}`}
              />
            ))}
          </div>
        )}

        <div className="flex items-center gap-1">
          {sizes.map((n) => (
            <button
              key={n}
              onClick={() => setSize(n)}
              className={clsx(
                "flex h-8 w-8 items-center justify-center rounded-lg transition",
                activeSize === n ? "bg-surface2 ring-1 ring-accent" : "hover:bg-surface2"
              )}
              aria-label={`Size ${n}`}
            >
              <span
                className="rounded-full bg-txt2"
                style={{
                  width: Math.max(4, Math.min(n, 14)),
                  height: Math.max(4, Math.min(n, 14)),
                }}
              />
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-0.5">
          <button
            onClick={() => setFingerDraw((v) => !v)}
            title={fingerDraw ? "Finger draws — tap to scroll with finger" : "Finger scrolls — tap to draw with finger"}
            className={clsx(
              "flex h-10 w-10 items-center justify-center rounded-lg transition",
              fingerDraw ? "bg-accent/15 text-accent" : "text-txt3 hover:bg-surface2"
            )}
          >
            <Hand className="h-[18px] w-[18px]" />
          </button>
          <button
            onClick={undo}
            disabled={strokes.current.length === 0}
            className="flex h-10 w-10 items-center justify-center rounded-lg text-txt3 transition hover:bg-surface2 disabled:opacity-30"
          >
            <Undo2 className="h-[18px] w-[18px]" />
          </button>
          <button
            onClick={redoFn}
            disabled={redo.current.length === 0}
            className="flex h-10 w-10 items-center justify-center rounded-lg text-txt3 transition hover:bg-surface2 disabled:opacity-30"
          >
            <Redo2 className="h-[18px] w-[18px]" />
          </button>
          <button
            onClick={clearAll}
            disabled={strokes.current.length === 0}
            title="Clear page"
            className="flex h-10 w-10 items-center justify-center rounded-lg text-txt3 transition hover:bg-surface2 hover:text-danger disabled:opacity-30"
          >
            <Trash2 className="h-[18px] w-[18px]" />
          </button>

          <button
            onClick={() => onTranscribe(strokes.current, height)}
            disabled={strokes.current.length === 0 || transcribing}
            className="ml-1 flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2.5 text-xs font-medium text-white transition active:opacity-80 disabled:opacity-40"
          >
            {transcribing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            <span className="hidden sm:inline">
              {transcribing ? "Reading…" : "Convert to text"}
            </span>
          </button>
        </div>
      </div>

      {/* page */}
      <div ref={wrapRef} className="min-h-0 flex-1 overflow-y-auto bg-surface2/40 p-2">
        <div
          className="relative mx-auto shadow-sm"
          style={{ width: PAGE_W * scale, height: height * scale }}
        >
          {/* ruled paper */}
          <div
            className="absolute inset-0 rounded-sm bg-white"
            style={{
              backgroundImage:
                "repeating-linear-gradient(to bottom, transparent 0 43px, #E6E8EF 43px 44px)",
              backgroundPosition: `0 ${12 * scale}px`,
              backgroundSize: `100% ${44 * scale}px`,
            }}
          />
          <canvas ref={baseRef} className="absolute inset-0" />
          <canvas
            ref={liveRef}
            className="absolute inset-0"
            style={{
              touchAction: penSeen.current && !fingerDraw ? "pan-y" : fingerDraw ? "none" : "pan-y",
              cursor: tool === "eraser" ? "cell" : "crosshair",
            }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={commit}
            onPointerCancel={commit}
            onPointerLeave={commit}
          />
        </div>
        <p className="py-3 text-center text-[11px] text-txt3">
          {penSeen.current
            ? "S Pen detected — your palm won’t draw. Scroll with a finger."
            : "Write with the S Pen. Turn on the hand icon to draw with a finger."}
        </p>
      </div>
    </div>
  );
}
