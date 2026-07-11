"use client";

import { useCallback, useEffect, useState } from "react";
import { Lightbulb, Bug, Check, Loader2, Undo2, Inbox, Trash2 } from "lucide-react";
import clsx from "clsx";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/lib/toast";

type Item = {
  id: string;
  kind: "feature" | "bug";
  body: string;
  status: string;
  user_email: string | null;
  created_at: string;
  cleared_at: string | null;
};

export default function FeedbackInbox() {
  const supabase = createClient();
  const [items, setItems] = useState<Item[]>([]);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"open" | "cleared">("open");

  const load = useCallback(async () => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;

    const { data: admin } = await supabase
      .from("app_admins")
      .select("user_id")
      .eq("user_id", u.user.id)
      .maybeSingle();
    setIsAdmin(Boolean(admin));

    const { data } = await supabase
      .from("feedback")
      .select("*")
      .order("created_at", { ascending: false });
    setItems((data as Item[]) ?? []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  const setStatus = async (i: Item, status: "open" | "cleared") => {
    setItems((cur) =>
      cur.map((x) => (x.id === i.id ? { ...x, status, cleared_at: status === "cleared" ? new Date().toISOString() : null } : x))
    );
    const { error } = await supabase
      .from("feedback")
      .update({
        status,
        cleared_at: status === "cleared" ? new Date().toISOString() : null,
      })
      .eq("id", i.id);
    if (error) {
      toast(error.message, "error");
      load();
    } else {
      window.dispatchEvent(new CustomEvent("cadence:feedback-changed"));
    }
  };

  const remove = async (i: Item) => {
    setItems((cur) => cur.filter((x) => x.id !== i.id));
    const { error } = await supabase.from("feedback").delete().eq("id", i.id);
    if (error) {
      toast(error.message, "error");
      load();
    } else {
      toast("Deleted");
      window.dispatchEvent(new CustomEvent("cadence:feedback-changed"));
    }
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-txt3" />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-lg px-6 py-16 text-center">
        <Inbox className="mx-auto mb-3 h-8 w-8 text-txt3" />
        <p className="text-sm text-txt2">This inbox is private.</p>
        <p className="mt-1 text-xs text-txt3">
          You can still send feature requests and bug reports from the button in the nav.
        </p>
      </div>
    );
  }

  const shown = items.filter((i) => i.status === tab);
  const openCount = items.filter((i) => i.status === "open").length;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl px-4 py-6 md:px-8">
        <div className="mb-5 flex items-center gap-3">
          <h1 className="text-2xl font-semibold">Feedback</h1>
          <span className="rounded-full bg-accent/15 px-2 py-0.5 text-xs font-medium text-accent">
            {openCount} open
          </span>
        </div>

        <div className="mb-4 flex gap-0.5 rounded-xl bg-surface2 p-0.5">
          {(
            [
              ["open", "Open"],
              ["cleared", "Cleared"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={clsx(
                "flex-1 rounded-lg py-2 text-sm transition",
                tab === id ? "bg-surface text-txt shadow-sm" : "text-txt3"
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {shown.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border py-10 text-center text-sm text-txt3">
            {tab === "open" ? "Nothing to look at. " : "Nothing cleared yet."}
          </p>
        ) : (
          <div className="space-y-2">
            {shown.map((i) => (
              <div
                key={i.id}
                className={clsx(
                  "rounded-xl border border-border bg-surface p-3",
                  i.status === "cleared" && "opacity-60"
                )}
              >
                <div className="mb-2 flex items-center gap-2">
                  <span
                    className={clsx(
                      "flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
                      i.kind === "bug"
                        ? "bg-danger/15 text-danger"
                        : "bg-accent/15 text-accent"
                    )}
                  >
                    {i.kind === "bug" ? (
                      <Bug className="h-3 w-3" />
                    ) : (
                      <Lightbulb className="h-3 w-3" />
                    )}
                    {i.kind === "bug" ? "Bug" : "Feature"}
                  </span>

                  <span className="min-w-0 truncate text-xs text-txt3">
                    {i.user_email ?? "unknown"}
                  </span>
                  <span className="shrink-0 text-xs text-txt3">
                    {new Date(i.created_at).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                    })}
                  </span>

                  <div className="ml-auto flex shrink-0 items-center gap-1">
                    {i.status === "open" ? (
                      <button
                        onClick={() => setStatus(i, "cleared")}
                        className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs text-txt2 hover:bg-surface2 hover:text-success"
                      >
                        <Check className="h-3.5 w-3.5" /> Clear
                      </button>
                    ) : (
                      <button
                        onClick={() => setStatus(i, "open")}
                        className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs text-txt2 hover:bg-surface2"
                      >
                        <Undo2 className="h-3.5 w-3.5" /> Reopen
                      </button>
                    )}
                    <button
                      onClick={() => remove(i)}
                      title="Delete permanently"
                      className="rounded-lg p-1.5 text-txt3 hover:bg-surface2 hover:text-danger"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                <ul className="space-y-1">
                  {i.body.split("\n").map((line, n) => (
                    <li key={n} className="flex gap-2 text-sm text-txt2">
                      <span className="text-txt3">•</span>
                      <span className="min-w-0 flex-1">{line}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
