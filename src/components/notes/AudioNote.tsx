"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Mic } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

function fmt(s: number) {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export default function AudioNote({
  path,
  seconds,
  transcript,
}: {
  path: string;
  seconds: number | null;
  transcript: string | null;
}) {
  const supabase = createClient();
  const [url, setUrl] = useState<string | null>(null);
  const [showRaw, setShowRaw] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      // the bucket is private — mint a short-lived signed URL
      const { data } = await supabase.storage.from("voice-memos").createSignedUrl(path, 3600);
      if (alive) setUrl(data?.signedUrl ?? null);
    })();
    return () => {
      alive = false;
    };
  }, [supabase, path]);

  return (
    <div className="mb-3 rounded-xl border border-border bg-surface p-3">
      <div className="mb-2 flex items-center gap-2 text-xs text-txt3">
        <Mic className="h-3.5 w-3.5 text-danger" />
        Voice memo
        {seconds ? <span className="tabular-nums">· {fmt(seconds)}</span> : null}
      </div>

      {url ? (
        <audio controls src={url} className="w-full" preload="none" />
      ) : (
        <p className="text-xs text-txt3">Loading audio…</p>
      )}

      {transcript && (
        <>
          <button
            onClick={() => setShowRaw((v) => !v)}
            className="mt-2 flex items-center gap-1 text-[11px] text-txt3 hover:text-txt2"
          >
            {showRaw ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            Raw transcript
          </button>
          {showRaw && (
            <p className="mt-1.5 whitespace-pre-wrap rounded-lg bg-bg p-2 text-xs leading-relaxed text-txt2">
              {transcript}
            </p>
          )}
        </>
      )}
    </div>
  );
}
