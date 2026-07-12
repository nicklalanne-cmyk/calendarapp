"use client";

import { useEffect, useRef, useState } from "react";
import { Palette } from "lucide-react";
import clsx from "clsx";

function hsvToHex(h: number, s: number, v: number) {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const to255 = (n: number) => Math.round((n + m) * 255);
  const toHex = (n: number) => to255(n).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

const WHEEL_SIZE = 140;
const RADIUS = WHEEL_SIZE / 2;

/** A visual HSV color wheel: hue/saturation picked from the ring, value from
 * a brightness slider underneath. Renders as a small swatch button that
 * opens a popover, matching the CustomColorSwatch trigger pattern. */
export default function ColorWheel({ onPick }: { onPick: (color: string) => void }) {
  const [open, setOpen] = useState(false);
  const [hue, setHue] = useState(0);
  const [sat, setSat] = useState(1);
  const [val, setVal] = useState(0.85);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !open) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.width = WHEEL_SIZE * dpr;
    c.height = WHEEL_SIZE * dpr;
    c.style.width = `${WHEEL_SIZE}px`;
    c.style.height = `${WHEEL_SIZE}px`;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    const img = ctx.createImageData(WHEEL_SIZE, WHEEL_SIZE);
    for (let y = 0; y < WHEEL_SIZE; y++) {
      for (let x = 0; x < WHEEL_SIZE; x++) {
        const dx = x - RADIUS;
        const dy = y - RADIUS;
        const r = Math.sqrt(dx * dx + dy * dy);
        const i = (y * WHEEL_SIZE + x) * 4;
        if (r > RADIUS) {
          img.data[i + 3] = 0;
          continue;
        }
        const h = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
        const s = Math.min(1, r / RADIUS);
        const hex = hsvToHex(h, s, val);
        const bigint = parseInt(hex.slice(1), 16);
        img.data[i] = (bigint >> 16) & 255;
        img.data[i + 1] = (bigint >> 8) & 255;
        img.data[i + 2] = bigint & 255;
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }, [open, val]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const pickAt = (clientX: number, clientY: number) => {
    const c = canvasRef.current;
    if (!c) return;
    const r = c.getBoundingClientRect();
    const x = clientX - r.left - RADIUS;
    const y = clientY - r.top - RADIUS;
    const dist = Math.sqrt(x * x + y * y);
    if (dist > RADIUS) return;
    const h = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
    const s = Math.min(1, dist / RADIUS);
    setHue(h);
    setSat(s);
    onPick(hsvToHex(h, s, val));
  };

  const current = hsvToHex(hue, sat, val);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        title="Color wheel"
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border"
        style={{
          background:
            "conic-gradient(red, yellow, lime, cyan, blue, magenta, red)",
        }}
      >
        <Palette className="h-3 w-3 text-white drop-shadow" />
      </button>
      {open && (
        <div
          ref={popRef}
          className="absolute left-0 top-8 z-20 w-[172px] rounded-xl border border-border bg-surface p-3 shadow-lg"
        >
          <canvas
            ref={canvasRef}
            className="cursor-crosshair rounded-full"
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              pickAt(e.clientX, e.clientY);
            }}
            onPointerMove={(e) => {
              if (e.buttons === 1) pickAt(e.clientX, e.clientY);
            }}
          />
          <div className="mt-2 flex items-center gap-2">
            <span className="text-[10px] text-txt3">Brightness</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={val}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                setVal(v);
                onPick(hsvToHex(hue, sat, v));
              }}
              className="flex-1"
            />
          </div>
          <div className="mt-2 flex items-center justify-between">
            <div className={clsx("h-6 w-6 rounded-full border border-border")} style={{ background: current }} />
            <span className="text-[10px] uppercase text-txt3">{current}</span>
          </div>
        </div>
      )}
    </div>
  );
}
