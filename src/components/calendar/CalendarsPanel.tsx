"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Eye, EyeOff } from "lucide-react";
import { getHiddenCals, setHiddenCals, syncHiddenCals } from "@/lib/calfilter";

type Cal = { id: string; summary: string; color: string | null; accountEmail: string };

export default function CalendarsPanel() {
  const [cals, setCals] = useState<Cal[]>([]);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setHidden(getHiddenCals());
    fetch("/api/google/calendars")
      .then((r) => r.json())
      .then((j) => setCals(j.calendars ?? []))
      .catch(() => {});
  }, []);

  const toggle = (id: string) => {
    const next = new Set(hidden);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setHidden(next);
    setHiddenCals(next);
  };

  if (cals.length === 0) return null;

  return (
    <div className="border-t border-border pt-3">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1 px-1 py-2 text-xs font-semibold uppercase tracking-wide text-txt3 md:py-0 md:pb-1 md:text-[11px]"
      >
        {open ? <ChevronDown className="h-4 w-4 md:h-3 md:w-3" /> : <ChevronRight className="h-4 w-4 md:h-3 md:w-3" />}
        Calendars <span className="text-txt3">{cals.length}</span>
      </button>
      {open && (
        <div className="max-h-56 space-y-0.5 overflow-y-auto md:max-h-48">
          {cals.map((c) => {
            const isHidden = hidden.has(c.id);
            return (
              <button
                key={c.id}
                onClick={() => toggle(c.id)}
                className="flex w-full items-center gap-2.5 rounded-lg px-1.5 py-2.5 text-left text-[13px] active:bg-surface2 md:py-1 md:text-xs md:hover:bg-surface"
              >
                <span
                  className="h-3 w-3 shrink-0 rounded-sm md:h-2.5 md:w-2.5"
                  style={{ backgroundColor: c.color ?? "#7C6CF0", opacity: isHidden ? 0.3 : 1 }}
                />
                <span className={`flex-1 truncate ${isHidden ? "text-txt3 line-through" : "text-txt2"}`}>
                  {c.summary}
                </span>
                {isHidden ? (
                  <EyeOff className="h-[18px] w-[18px] text-txt3 md:h-3.5 md:w-3.5" />
                ) : (
                  <Eye className="h-[18px] w-[18px] text-txt3 md:h-3.5 md:w-3.5" />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
