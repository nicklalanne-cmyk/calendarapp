"use client";

import { useEffect, useRef, useState } from "react";

const EMOJI = [
  "📄","📋","✅","🤝","🏡","🔑","💰","📈","📊","🗂️","📁","🧾","🗓️","⏰","📌","🎯",
  "🚀","🔥","⭐","💡","🛠️","🧰","📞","✉️","👥","🧑‍💼","🏢","🌆","🌴","🚗","🛋️","🪑",
  "🖼️","📷","🎬","🎧","📝","🔍","⚖️","🏦","💳","🧮","🗺️","📍","🏷️","🎁","☕","🍽️",
];

export default function IconPicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (icon: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        onClick={() => setOpen((v) => !v)}
        title="Change icon"
        className="flex h-11 w-11 items-center justify-center rounded-xl text-2xl transition hover:bg-surface2 md:h-10 md:w-10"
      >
        {value || "📄"}
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-[264px] rounded-xl border border-border bg-surface p-2 shadow-2xl">
          <div className="grid grid-cols-8 gap-0.5">
            {EMOJI.map((e) => (
              <button
                key={e}
                onClick={() => {
                  onChange(e);
                  setOpen(false);
                }}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-lg hover:bg-surface2"
              >
                {e}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
