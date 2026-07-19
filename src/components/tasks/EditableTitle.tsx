"use client";

import { useState } from "react";
import clsx from "clsx";

/**
 * Click-to-edit text — renders as plain text until clicked, then swaps to an
 * input that saves on blur/Enter and reverts on Escape. Used for subtask
 * titles wherever they're displayed (Agenda rows, the task detail modal,
 * and a parent task's expanded subtask list) so renaming one doesn't
 * require opening a separate edit form.
 */
export default function EditableTitle({
  value,
  onSave,
  className,
  disabled,
}: {
  value: string;
  onSave: (next: string) => void;
  className?: string;
  disabled?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  const commit = () => {
    setEditing(false);
    const v = draft.trim();
    if (v && v !== value) onSave(v);
    else setDraft(value);
  };

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => e.target.select()}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
          if (e.key === "Escape") {
            e.stopPropagation();
            setDraft(value);
            setEditing(false);
          }
        }}
        onBlur={commit}
        className={clsx("bg-transparent outline-none", className)}
      />
    );
  }

  return (
    <span
      onClick={(e) => {
        if (disabled) return;
        e.stopPropagation();
        setDraft(value);
        setEditing(true);
      }}
      className={clsx(!disabled && "cursor-text", className)}
    >
      {value}
    </span>
  );
}
