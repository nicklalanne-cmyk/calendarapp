"use client";

import { Check } from "lucide-react";
import { choiceOf, formatValue, type PageProperty } from "@/lib/pages";

/** Non-interactive rendering of a value — safe to place inside another button. */
export default function ValueChip({ prop, value }: { prop: PageProperty; value: unknown }) {
  if (value == null || value === "") return null;

  if (prop.type === "select") {
    const c = choiceOf(prop, value);
    if (!c) return null;
    return (
      <span
        className="rounded-md px-1.5 py-0.5 text-[11px] font-medium"
        style={{ background: `${c.color}26`, color: c.color }}
      >
        {c.label}
      </span>
    );
  }

  if (prop.type === "checkbox") {
    return value ? (
      <span className="flex items-center gap-0.5 text-[11px] text-accent">
        <Check className="h-3 w-3" />
        {prop.name}
      </span>
    ) : null;
  }

  return (
    <span className="truncate text-[11px] text-txt3">
      <span className="text-txt3/60">{prop.name}: </span>
      {formatValue(value, prop)}
    </span>
  );
}
