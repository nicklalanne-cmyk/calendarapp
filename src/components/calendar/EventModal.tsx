"use client";

import { useEffect, useState } from "react";
import { format, isSameDay } from "date-fns";
import {
  Trash2, MapPin, AlignLeft, Users, Video, Repeat, Calendar as CalIcon, Pencil, X, ListTodo,
} from "lucide-react";
import clsx from "clsx";
import type { Attendee } from "@/lib/types";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/lib/toast";
import FollowUpMenu from "@/components/FollowUpMenu";

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
  /** The master event's id, present when this draft is one expanded instance
   * of a recurring event. Needed to target the whole series on edit/delete. */
  recurringEventId?: string | null;
  /** All-day (or multi-day) event — `start`/`end` are still Date objects at
   * local midnight, but no time-of-day is meaningful. `end` follows Google's
   * exclusive-end-date convention (the day AFTER the last inclusive day). */
  allDay?: boolean;
  /** For a recurring instance: whether a save/delete should apply to just
   * this occurrence or the whole series. Only meaningful when
   * recurringEventId is set; defaults to "occurrence" (today's behavior). */
  scope?: "occurrence" | "series";
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

function dayBefore(d: Date): Date {
  const out = new Date(d);
  out.setDate(out.getDate() - 1);
  return out;
}

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
  onConvertToTask,
  onAddFollowUp,
}: {
  draft: EventDraft;
  onSave: (d: EventDraft) => void;
  onDelete?: (scope?: "occurrence" | "series") => void;
  onClose: () => void;
  /** Creates a task from this event's title/time and closes the modal. */
  onConvertToTask?: (d: EventDraft) => void;
  /** Creates a new follow-up task due on the picked date/offset. */
  onAddFollowUp?: (d: EventDraft, dueDate: string, dueKind: "day" | "week") => void;
}) {
  // Existing events open read-only — you have to explicitly hit Edit to
  // change anything. New events (no id yet) open straight into the form
  // since there's nothing to view yet.
  const [mode, setMode] = useState<"view" | "edit">(draft.id ? "view" : "edit");

  const [title, setTitle] = useState(draft.title);
  const [date, setDate] = useState(format(draft.start, "yyyy-MM-dd"));
  const [startTime, setStartTime] = useState(format(draft.start, "HH:mm"));
  const [endTime, setEndTime] = useState(format(draft.end, "HH:mm"));
  const [location, setLocation] = useState(draft.location ?? "");
  const [description, setDescription] = useState(draft.description ?? "");
  const [repeat, setRepeat] = useState<string>("none");
  const [scope, setScope] = useState<"occurrence" | "series">("occurrence");
  const canPickScope = Boolean(draft.recurring && draft.recurringEventId);
  const [allDay, setAllDayState] = useState(!!draft.allDay);
  // Inclusive last day for an all-day event, shown to the user. draft.end
  // follows Google's exclusive-end-date convention (one day past the last
  // real day), so we subtract a day here and add it back on save.
  const [endDate, setEndDate] = useState(() =>
    format(draft.allDay ? dayBefore(draft.end) : draft.start, "yyyy-MM-dd")
  );
  // Checking "All day" on a previously-timed event has no meaningful old end
  // date to fall back to, so it resets to a single day rather than keeping
  // whatever time-based end happened to be set.
  const setAllDay = (checked: boolean) => {
    setAllDayState(checked);
    if (checked) setEndDate(date);
  };
  const viewEnd = draft.allDay ? dayBefore(draft.end) : draft.end;

  // Sharing with partner — a denormalised snapshot in `shared_events`, never
  // touches Google. Only meaningful for a real, already-created event.
  const supabase = createClient();
  const [shared, setShared] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  useEffect(() => {
    if (!draft.id) return;
    let alive = true;
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      const uid = u.user?.id ?? null;
      if (!alive) return;
      setCurrentUserId(uid);
      if (!uid) return;
      const { data } = await supabase
        .from("shared_events")
        .select("id")
        .eq("owner_user_id", uid)
        .eq("event_id", draft.id)
        .maybeSingle();
      if (!alive) return;
      setShared(Boolean(data));
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.id]);

  // "Share" tries a real Google Calendar invite first — adds the partner as
  // an actual attendee (sendUpdates=all), so Google emails them and it lands
  // on their real calendar, not just a read-only copy inside Cadence. Only
  // falls back to the old denormalised `shared_events` snapshot if the
  // partner hasn't connected a Google account to invite.
  const toggleShare = async () => {
    if (!draft.id || !currentUserId) return;
    setSharing(true);
    try {
      if (shared) {
        if (draft.accountId) {
          await fetch(
            `/api/google/events/${draft.id}/invite-partner?accountId=${draft.accountId}&calendarId=${encodeURIComponent(draft.calendarId ?? "primary")}`,
            { method: "DELETE" }
          ).catch(() => null);
        }
        const { error } = await supabase
          .from("shared_events")
          .delete()
          .eq("owner_user_id", currentUserId)
          .eq("event_id", draft.id);
        if (error) throw new Error(error.message);
        setShared(false);
        toast("Unshared");
      } else {
        if (draft.accountId) {
          const res = await fetch(
            `/api/google/events/${draft.id}/invite-partner?accountId=${draft.accountId}&calendarId=${encodeURIComponent(draft.calendarId ?? "primary")}`,
            { method: "POST" }
          );
          const j = await res.json().catch(() => ({}));
          if (res.ok && (j.invited || j.alreadyInvited)) {
            setShared(true);
            toast(`Invited ${j.email} — it'll show on their Google Calendar`);
            return;
          }
          if (j.error === "partner_no_google_account") {
            toast("Your partner hasn't connected a Google account — sharing inside Cadence only", "error");
          } else if (j.error === "no_partner_linked") {
            toast("No partner account linked yet", "error");
            return;
          }
          // Any other failure (token issue, API error): fall through to the
          // in-app-only snapshot below rather than losing the share entirely.
        }
        const row = {
          owner_user_id: currentUserId,
          account_id: draft.accountId ?? null,
          calendar_id: draft.calendarId ?? null,
          event_id: draft.id,
          title: draft.title,
          location: draft.location || null,
          start_at: draft.start.toISOString(),
          end_at: draft.end.toISOString(),
          all_day: false,
        };
        const { error } = await supabase
          .from("shared_events")
          .upsert(row, { onConflict: "owner_user_id,event_id" });
        if (error) throw new Error(error.message);
        setShared(true);
      }
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setSharing(false);
    }
  };

  // Discard any in-progress edits and go back to the read-only view.
  const cancelEdit = () => {
    setTitle(draft.title);
    setDate(format(draft.start, "yyyy-MM-dd"));
    setStartTime(format(draft.start, "HH:mm"));
    setEndTime(format(draft.end, "HH:mm"));
    setLocation(draft.location ?? "");
    setDescription(draft.description ?? "");
    setAllDayState(!!draft.allDay);
    setEndDate(format(draft.allDay ? dayBefore(draft.end) : draft.start, "yyyy-MM-dd"));
    setMode("view");
  };

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

  const build = (dateStr: string, hhmm: string) => {
    const [h, m] = hhmm.split(":").map(Number);
    const d = new Date(`${dateStr}T00:00:00`);
    d.setHours(h, m, 0, 0);
    return d;
  };

  const save = () => {
    let startAt: Date;
    let endAt: Date;
    if (allDay) {
      startAt = new Date(`${date}T00:00:00`);
      const inclusiveEndAt = new Date(`${(endDate || date)}T00:00:00`);
      // Google's all-day end date is exclusive — the day after the last
      // real day — even for a single-day event.
      endAt = new Date(inclusiveEndAt);
      endAt.setDate(endAt.getDate() + 1);
      if (endAt <= startAt) endAt = new Date(startAt.getTime() + 24 * 60 * 60 * 1000);
    } else {
      startAt = build(date, startTime);
      endAt = build(date, endTime);
      if (endAt <= startAt) endAt = new Date(endAt.getTime() + 24 * 60 * 60 * 1000);
    }
    const [accId, calId] = target.includes("::") ? target.split("::") : [undefined, undefined];
    onSave({
      id: draft.id,
      title: title.trim() || "(No title)",
      start: startAt,
      end: endAt,
      allDay,
      accountId: draft.id ? draft.accountId : (accId ?? draft.accountId),
      calendarId: draft.id ? draft.calendarId : (calId ?? draft.calendarId),
      location: location.trim(),
      description: description.trim(),
      recurrence: draft.id ? undefined : RRULE[repeat],
      recurringEventId: draft.recurringEventId,
      scope: canPickScope ? scope : undefined,
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
        <div className="mb-1 flex items-start gap-2">
          <h3 className="flex-1 text-lg font-semibold">
            {mode === "edit" ? (draft.id ? "Edit event" : "New event") : draft.title || "(No title)"}
          </h3>
          <button
            onClick={onClose}
            aria-label="Close"
            className="-m-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-txt3 active:bg-surface hover:bg-surface hover:text-txt"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mb-4 text-sm text-txt3">
          {draft.allDay && !isSameDay(draft.start, viewEnd)
            ? `${format(draft.start, "MMM d")} – ${format(viewEnd, "MMM d")}`
            : format(draft.start, "EEEE, MMM d")}
          {mode === "view" && (draft.allDay ? " · All day" : ` · ${format(draft.start, "h:mm a")} – ${format(draft.end, "h:mm a")}`)}
          {draft.accountEmail ? ` · ${draft.accountEmail}` : ""}
        </p>

        {mode === "view" ? (
          <>
            {draft.location && (
              <div className="mb-3 flex items-center gap-2 text-sm text-txt2">
                <MapPin className="h-4 w-4 shrink-0 text-txt3" />
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(draft.location)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="min-w-0 flex-1 underline decoration-txt3/40 underline-offset-2 hover:text-accentSoft"
                  onClick={(e) => e.stopPropagation()}
                >
                  {draft.location}
                </a>
              </div>
            )}

            {draft.description && (
              <div className="mb-3 flex gap-2 text-sm text-txt2">
                <AlignLeft className="mt-0.5 h-4 w-4 shrink-0 text-txt3" />
                <p className="min-w-0 flex-1 whitespace-pre-wrap">{draft.description}</p>
              </div>
            )}

            {draft.recurring && (
              <div className="mb-3 flex items-center gap-2 text-xs text-txt3">
                <Repeat className="h-3.5 w-3.5" /> Repeating event
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

            {!draft.location && !draft.description && attendees.length === 0 && !draft.meetingLink && (
              <p className="mb-4 text-sm text-txt3">No other details.</p>
            )}

            {canPickScope && (
              <div className="mb-3 flex items-center gap-1.5 text-xs text-txt3">
                <Repeat className="h-3.5 w-3.5" />
                <select
                  value={scope}
                  onChange={(e) => setScope(e.target.value as "occurrence" | "series")}
                  className="rounded-md border border-border bg-bg px-1.5 py-1 text-xs text-txt2"
                >
                  <option value="occurrence">This event only</option>
                  <option value="series">The whole series</option>
                </select>
                <span>applies to Delete and Edit below</span>
              </div>
            )}

            <div className="flex items-center gap-2">
              {draft.id && onDelete ? (
                <button
                  onClick={() => onDelete(canPickScope ? scope : undefined)}
                  className="flex items-center gap-1.5 rounded-lg border border-border px-4 py-3 text-sm text-danger active:bg-surface2 md:px-3 md:py-2 md:hover:bg-surface"
                >
                  <Trash2 className="h-4 w-4" />
                  {canPickScope && scope === "series" ? "Delete series" : "Delete"}
                </button>
              ) : null}
              {draft.id && onConvertToTask && (
                <button
                  onClick={() => onConvertToTask(draft)}
                  title="Convert to task"
                  className="flex items-center gap-1.5 rounded-lg border border-border px-4 py-3 text-sm text-txt2 active:bg-surface2 md:px-3 md:py-2 md:hover:bg-surface"
                >
                  <ListTodo className="h-4 w-4" /> To task
                </button>
              )}
              {draft.id && (
                <button
                  onClick={toggleShare}
                  disabled={sharing}
                  className={clsx(
                    "flex items-center gap-1.5 rounded-lg border px-4 py-3 text-sm active:bg-surface2 disabled:opacity-50 md:px-3 md:py-2 md:hover:bg-surface",
                    shared ? "border-accent text-accent" : "border-border text-txt2"
                  )}
                >
                  <Users className="h-4 w-4" fill={shared ? "currentColor" : "none"} />
                  {shared ? "Shared" : "Share"}
                </button>
              )}
              <button
                onClick={() => setMode("edit")}
                className="ml-auto flex items-center gap-1.5 rounded-lg bg-accent px-6 py-3 text-sm font-medium text-white active:opacity-80 md:px-4 md:py-2 md:hover:bg-accentSoft"
              >
                <Pencil className="h-4 w-4" /> Edit
              </button>
            </div>

            {draft.id && onAddFollowUp && (
              <div className="mt-2">
                <FollowUpMenu
                  base={draft.start}
                  compact
                  onPick={(d, k) => onAddFollowUp(draft, d, k)}
                />
              </div>
            )}
          </>
        ) : (
          <>
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title"
          className="mb-3 w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-base outline-none focus:border-accent md:py-2 md:text-sm"
        />

        {canPickScope && (
          <div className="mb-3 flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-xs text-txt3">
            <Repeat className="h-3.5 w-3.5 shrink-0" />
            <span>This event repeats — save changes to</span>
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value as "occurrence" | "series")}
              className="ml-auto rounded-md border border-border bg-bg px-1.5 py-1 text-xs text-txt2"
            >
              <option value="occurrence">This event only</option>
              <option value="series">The whole series</option>
            </select>
          </div>
        )}

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

        <label className="mb-3 flex items-center gap-2 text-sm text-txt2">
          <input
            type="checkbox"
            checked={allDay}
            onChange={(e) => setAllDay(e.target.checked)}
            className="h-4 w-4 accent-accent"
          />
          All day
        </label>

        <div className="mb-3 flex items-center gap-2">
          <CalIcon className="h-4 w-4 shrink-0 text-txt3" />
          <input
            type="date"
            value={date}
            onChange={(e) => e.target.value && setDate(e.target.value)}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-base outline-none focus:border-accent md:py-2 md:text-sm"
          />
          {allDay && (
            <>
              <span className="shrink-0 text-txt3">→</span>
              <input
                type="date"
                value={endDate}
                min={date}
                onChange={(e) => e.target.value && setEndDate(e.target.value)}
                className="w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-base outline-none focus:border-accent md:py-2 md:text-sm"
              />
            </>
          )}
        </div>

        {!allDay && (
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
        )}

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
          <button
            onClick={() => (draft.id ? cancelEdit() : onClose())}
            className="rounded-lg border border-border px-4 py-3 text-sm active:bg-surface2 md:px-3 md:py-2 md:hover:bg-surface"
          >
            Cancel
          </button>
          <button
            onClick={save}
            className="ml-auto rounded-lg bg-accent px-6 py-3 text-sm font-medium text-white active:opacity-80 md:px-4 md:py-2 md:hover:bg-accentSoft"
          >
            Save
          </button>
        </div>
        </>
        )}
      </div>
    </div>
  );
}
