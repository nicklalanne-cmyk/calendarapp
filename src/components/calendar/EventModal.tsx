"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import { Trash2, MapPin, AlignLeft, Users, Video, Repeat, Calendar as CalIcon } from "lucide-react";
import type { Attendee } from "@/lib/types";

export type EventDraft = {
  id?: string;
  title: string;
  start: Date;
  end: Date;
  accountId?: string;
  calendarId?: string;
  accountEmail?: string;
  location?: string;
  description?: string;
  attendees?: Attendee[];
  meetingLink?: string | null;
  recurrence?: string[] | null;
  recurring?: boolean;
};

const RRULE: Record<string, string[] | null> = {
  none: null,
  daily: ["RRULE:FREQ=DAILY"],
  weekdays: ["RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"],
  weekly: ["RRULE:FREQ=WEEKLY"],
  monthly: ["RRULE:FREQ=MONTHLY"],
};

type Cal = {
  id: string;
  summary: string;
  color: string | null;
  accountEmail: string;
  accountId: string;
  canWrite: boolean;
  primary: boolean;
};

const STATUS_COLOR: Record<string, string> = {
  accepted: "#4FD1A5",
  declined: "#F06C7C",
  tentative: "#F0A24F",
  needsAction: "#6E6E7A",
};

export default function EventModal({
  draft,
  onSave,
  onDelete,
  onClose,
}: {
  draft: EventDraft;
  onSave: (d: EventDraft) => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(draft.title);
  const [startTime, setStartTime] = useState(format(draft.start, "HH:mm"));
  const [endTime, setEndTime] = useState(format(draft.end, "HH:mm"));
  const [location, setLocation] = useState(draft.location ?? "");
  const [description, setDescription] = useState(draft.description ?? "");
  const [repeat, setRepeat] = useState<string>("none");

  // which calendar to write to — only meaningful for NEW events
  const [cals, setCals] = useState<Cal[]>([]);
  const [target, setTarget] = useState<string>(
    draft.accountId && draft.calendarId ? `${draft.accountId}::${draft.calendarId}` : ""
  );

  useEffect(() => {
    if (draft.id) return; // editing: never move an existing event between calendars here
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/google/calendars");
        const j = (await res.json()) as { calendars?: Cal[] };
        const writable = (j.calendars ?? []).filter((c) => c.canWrite);
        if (!alive) return;
        setCals(writable);
        if (!target) {
          const def = writable.find((c) => c.primary) ?? writable[0];
          if (def) setTarget(`${def.accountId}::${def.id}`);
        }
      } catch {
        /* the picker just won't show */
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.id]);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);

  const build = (base: Date, hhmm: string) => {
    const [h, m] = hhmm.split(":").map(Number);
    const d = new Date(base);
    d.setHours(h, m, 0, 0);
    return d;
  };

  const save = () => {
    const startAt = build(draft.start, startTime);
    let endAt = build(draft.start, endTime);
    if (endAt <= startAt) endAt = new Date(endAt.getTime() + 24 * 60 * 60 * 1000);
    const [accId, calId] = target.includes("::") ? target.split("::") : [undefined, undefined];
    onSave({
      id: draft.id,
      title: title.trim() || "(No title)",
      start: startAt,
      end: endAt,
      accountId: draft.id ? draft.accountId : (accId ?? draft.accountId),
      calendarId: draft.id ? draft.calendarId : (calId ?? draft.calendarId),
      location: location.trim(),
      description: description.trim(),
      recurrence: draft.id ? undefined : RRULE[repeat],
    });
  };

  const attendees = draft.attendees ?? [];

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 px-6"
      style={{ height: "var(--app-height, 100dvh)" }}
      onClick={onClose}
    >
      <div
        className="max-h-[85%] w-full max-w-md overflow-y-auto rounded-2xl border border-border bg-surface2 p-5 shadow-2xl md:max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-1 text-lg font-semibold">{draft.id ? "Edit event" : "New event"}</h3>
        <p className="mb-4 text-sm text-txt3">
          {format(draft.start, "EEEE, MMM d")}
          {draft.accountEmail ? ` · ${draft.accountEmail}` : ""}
        </p>

        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title"
          className="mb-3 w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-base outline-none focus:border-accent md:py-2 md:text-sm"
        />

        {!draft.id && cals.length > 1 && (
          <div className="mb-3 flex items-center gap-2">
            <CalIcon className="h-4 w-4 shrink-0 text-txt3" />
            <select
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              className="w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-base outline-none focus:border-accent md:py-2 md:text-sm"
            >
              {cals.map((c) => (
                <option key={`${c.accountId}::${c.id}`} value={`${c.accountId}::${c.id}`}>
                  {c.summary}
                  {cals.some((o) => o.accountEmail !== c.accountEmail)
                    ? ` — ${c.accountEmail}`
                    : ""}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="mb-3 flex items-center gap-2">
          <input
            type="time"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            className="rounded-lg border border-border bg-surface px-3 py-2.5 text-base outline-none focus:border-accent md:py-2 md:text-sm"
          />
          <span className="text-txt3">→</span>
          <input
            type="time"
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
            className="rounded-lg border border-border bg-surface px-3 py-2.5 text-base outline-none focus:border-accent md:py-2 md:text-sm"
          />
        </div>

        <div className="mb-3 flex items-center gap-2 rounded-lg border border-border bg-surface px-3">
          <MapPin className="h-4 w-4 shrink-0 text-txt3" />
          <input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="Add location"
            className="w-full bg-transparent py-2.5 text-base outline-none placeholder:text-txt3 md:py-2 md:text-sm"
          />
        </div>

        <div className="mb-3 flex gap-2 rounded-lg border border-border bg-surface px-3 py-2">
          <AlignLeft className="mt-0.5 h-4 w-4 shrink-0 text-txt3" />
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Add description / notes"
            rows={3}
            className="w-full resize-none bg-transparent text-base outline-none placeholder:text-txt3 md:text-sm"
          />
        </div>

        {!draft.id && (
          <div className="mb-3 flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2">
            <Repeat className="h-4 w-4 shrink-0 text-txt3" />
            <select
              value={repeat}
              onChange={(e) => setRepeat(e.target.value)}
              className="w-full bg-transparent text-sm text-txt outline-none"
            >
              <option value="none">Does not repeat</option>
              <option value="daily">Every day</option>
              <option value="weekdays">Every weekday (Mon–Fri)</option>
              <option value="weekly">Every week</option>
              <option value="monthly">Every month</option>
            </select>
          </div>
        )}

        {draft.recurring && (
          <div className="mb-3 flex items-center gap-2 text-xs text-txt3">
            <Repeat className="h-3.5 w-3.5" /> Repeating event — edits apply to this occurrence
          </div>
        )}

        {draft.meetingLink && (
          <a
            href={draft.meetingLink}
            target="_blank"
            rel="noopener noreferrer"
            className="mb-3 flex items-center justify-center gap-2 rounded-lg bg-accent/15 px-3 py-2 text-sm font-medium text-accentSoft hover:bg-accent/25"
          >
            <Video className="h-4 w-4" /> Join video call
          </a>
        )}

        {attendees.length > 0 && (
          <div className="mb-4 rounded-lg border border-border bg-surface p-3">
            <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase text-txt3">
              <Users className="h-3.5 w-3.5" /> {attendees.length} invited
            </div>
            <div className="flex flex-col gap-1.5">
              {attendees.map((a) => (
                <div key={a.email} className="flex items-center gap-2 text-sm">
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: STATUS_COLOR[a.responseStatus ?? "needsAction"] ?? "#6E6E7A" }}
                    title={a.responseStatus ?? "no response"}
                  />
                  <span className="truncate text-txt2">
                    {a.name || a.email}
                    {a.self ? " (you)" : ""}
                    {a.organizer ? " · organizer" : ""}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex items-center gap-2">
          {draft.id && onDelete ? (
            <button
              onClick={() => onDelete()}
              className="flex items-center gap-1.5 rounded-lg border border-border px-4 py-3 text-sm text-danger active:bg-surface2 md:px-3 md:py-2 md:hover:bg-surface"
            >
              <Trash2 className="h-4 w-4" /> Delete
            </button>
          ) : (
            <button
              onClick={onClose}
              className="rounded-lg border border-border px-4 py-3 text-sm active:bg-surface2 md:px-3 md:py-2 md:hover:bg-surface"
            >
              Cancel
            </button>
          )}
          <button
            onClick={save}
            className="ml-auto rounded-lg bg-accent px-6 py-3 text-sm font-medium text-white active:opacity-80 md:px-4 md:py-2 md:hover:bg-accentSoft"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
