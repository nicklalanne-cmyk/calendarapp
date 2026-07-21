"use client";

import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import clsx from "clsx";

// Pull-to-refresh on mobile only (matches the lg:hidden breakpoint used
// throughout AppShell for phone-specific chrome). Reloads the whole page —
// simplest way to guarantee every page's mix of server + client-fetched
// data actually comes back fresh, rather than trying to special-case each
// page's own fetching logic.
const PULL_THRESHOLD = 70; // px of pull before a refresh fires
const MAX_PULL = 110; // visual cap so the indicator doesn't drag forever
const RESISTANCE = 0.5; // pull feels heavier than a 1:1 finger drag

// Only start a pull when the touch begins at the very top of whatever
// scrollable area it's inside — otherwise this would hijack normal
// scrolling anywhere else in a long list.
function findScrollParent(node: HTMLElement | null): HTMLElement | null {
  let el = node;
  while (el && el !== document.body) {
    const style = window.getComputedStyle(el);
    if (/(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight) return el;
    el = el.parentElement;
  }
  return null;
}

// Components that manage their own touch gestures (e.g. the notebook's
// drawing canvas) opt out via touch-action: none — respect that instead of
// hijacking their touches for the pull gesture.
function touchesOwnGesture(node: HTMLElement | null): boolean {
  let el = node;
  while (el && el !== document.body) {
    if (window.getComputedStyle(el).touchAction === "none") return true;
    el = el.parentElement;
  }
  return false;
}

export default function PullToRefresh({ children }: { children: React.ReactNode }) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const stateRef = useRef<{ startY: number; dragging: boolean; scrollEl: HTMLElement | null }>({
    startY: 0,
    dragging: false,
    scrollEl: null,
  });

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    const onTouchStart = (e: TouchEvent) => {
      if (refreshing) return;
      if (window.innerWidth >= 1024) return; // desktop has its own layout; this is a mobile-only gesture
      const target = e.target as HTMLElement;
      if (touchesOwnGesture(target)) return;
      const scrollEl = findScrollParent(target);
      const scrollTop = scrollEl ? scrollEl.scrollTop : 0;
      if (scrollTop > 0) {
        stateRef.current.dragging = false;
        return;
      }
      const touch = e.touches[0];
      stateRef.current = { startY: touch.clientY, dragging: true, scrollEl };
    };

    const onTouchMove = (e: TouchEvent) => {
      const st = stateRef.current;
      if (!st.dragging || refreshing) return;
      const touch = e.touches[0];
      const delta = touch.clientY - st.startY;
      if (delta <= 0) {
        setPull(0);
        return;
      }
      // If the target container actually scrolled in the meantime, bail —
      // this is a normal scroll, not a pull.
      if (st.scrollEl && st.scrollEl.scrollTop > 0) {
        st.dragging = false;
        setPull(0);
        return;
      }
      e.preventDefault();
      setPull(Math.min(delta * RESISTANCE, MAX_PULL));
    };

    const onTouchEnd = () => {
      const st = stateRef.current;
      if (!st.dragging) return;
      st.dragging = false;
      setPull((current) => {
        if (current >= PULL_THRESHOLD) {
          setRefreshing(true);
          window.location.reload();
        }
        return 0;
      });
    };

    wrapper.addEventListener("touchstart", onTouchStart, { passive: true });
    wrapper.addEventListener("touchmove", onTouchMove, { passive: false });
    wrapper.addEventListener("touchend", onTouchEnd, { passive: true });
    wrapper.addEventListener("touchcancel", onTouchEnd, { passive: true });
    return () => {
      wrapper.removeEventListener("touchstart", onTouchStart);
      wrapper.removeEventListener("touchmove", onTouchMove);
      wrapper.removeEventListener("touchend", onTouchEnd);
      wrapper.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [refreshing]);

  return (
    <div ref={wrapperRef} className="relative h-full min-h-0 w-full overflow-hidden">
      <div
        className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-center justify-center overflow-hidden lg:hidden"
        style={{ height: refreshing ? 44 : pull, transition: pull ? undefined : "height 150ms" }}
      >
        {(pull > 0 || refreshing) && (
          <RefreshCw
            className={clsx("h-5 w-5 text-accent", refreshing && "animate-spin")}
            style={!refreshing ? { transform: `rotate(${(pull / PULL_THRESHOLD) * 360}deg)` } : undefined}
          />
        )}
      </div>
      <div
        className="h-full min-h-0 w-full"
        style={{ transform: pull ? `translateY(${pull}px)` : undefined, transition: pull ? undefined : "transform 150ms" }}
      >
        {children}
      </div>
    </div>
  );
}
