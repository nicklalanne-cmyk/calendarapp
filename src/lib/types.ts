export type NotebookPageTemplate = "blank" | "lined" | "grid" | "dotted" | "pdf";

export type NotebookFolder = {
  id: string;
  user_id: string;
  name: string;
  color: string;
  position: number;
  created_at: string;
};

export type Notebook = {
  id: string;
  user_id: string;
  title: string;
  color: string;
  icon: string | null;
  position: number;
  pinned_at: string | null;
  shared: boolean;
  folder_id: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export type NotebookPdf = {
  id: string;
  notebook_id: string;
  user_id: string;
  storage_path: string;
  filename: string;
  page_count: number;
  created_at: string;
};

/** A text box or image dropped onto a page — kept separate from ink strokes
 * since they're positioned/sized rectangles, not freehand point paths. */
export type NotebookPageElement =
  | {
      id: string;
      type: "text";
      x: number;
      y: number;
      w: number;
      h: number;
      rotation?: number;
      text: string;
      color: string;
      fontSize: number;
    }
  | {
      id: string;
      type: "image";
      x: number;
      y: number;
      w: number;
      h: number;
      rotation?: number;
      storagePath: string;
    };

export type NotebookPage = {
  id: string;
  notebook_id: string;
  user_id: string;
  position: number;
  template: NotebookPageTemplate;
  pdf_id: string | null;
  pdf_page_index: number | null;
  width: number;
  height: number;
  strokes: import("@/lib/ink").Stroke[];
  elements: NotebookPageElement[];
  created_at: string;
  updated_at: string;
};

export type Task = {
  id: string;
  user_id: string;
  title: string;
  notes: string | null;
  is_done: boolean;
  due_date: string | null;
  priority: number;
  repeat: string | null;
  rrule: string | null;
  due_kind: "day" | "week";
  project: string | null;
  location: string | null;
  sort_order: number | null;
  parent_id: string | null;
  tags: string[] | null;
  estimate_minutes: number | null;
  scheduled_start: string | null;
  scheduled_end: string | null;
  google_event_id: string | null;
  google_account_id: string | null;
  google_calendar_id: string | null;
  /** A meeting this task is ABOUT (not the time-block created for it). */
  linked_event_id: string | null;
  linked_event_calendar_id: string | null;
  linked_event_account_id: string | null;
  linked_event_title: string | null;
  linked_event_start: string | null;
  created_at: string;
  shared: boolean;
};

export type Note = {
  id: string;
  user_id: string;
  title: string;
  body: string;
  note_date: string | null;
  task_id: string | null;
  audio_path: string | null;
  transcript: string | null;
  duration_seconds: number | null;
  ink: { v: 1; strokes: unknown[] } | null;
  ink_height: number | null;
  event_id: string | null;
  event_calendar_id: string | null;
  event_account_id: string | null;
  event_title: string | null;
  event_start: string | null;
  updated_at: string;
  pinned_at: string | null;
  shared: boolean;
  source: string | null;
};

export type Attendee = {
  email: string;
  name?: string | null;
  responseStatus?: string | null;
  self?: boolean;
  organizer?: boolean;
};

export type CalendarEvent = {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  color?: string | null;
  location?: string | null;
  description?: string | null;
  attendees?: Attendee[];
  meetingLink?: string | null;
  htmlLink?: string | null;
  recurring?: boolean;
  /** Set when this is one expanded instance of a recurring event — the id of
   * the *master* event, which PATCH/DELETE must target to affect the whole
   * series instead of just this occurrence. Absent for non-recurring events
   * and for the master event itself (if ever fetched directly). */
  recurringEventId?: string | null;
  accountId: string;
  accountEmail: string;
  calendarId: string;
  source: "google" | "task";
  /** set when source === "task" */
  taskId?: string;
  taskDone?: boolean;
};

export type ConnectedAccount = {
  id: string;
  google_email: string;
  is_default: boolean;
  /** false when the stored refresh token no longer works (revoked/expired) —
   * that account's calendars silently stop syncing until reconnected. */
  healthy?: boolean;
};

/** A denormalised snapshot of a Google Calendar event, dropped into the DB so
 * a partner's Cadence RLS can see it — never touches Google, no invite sent. */
export type SharedEvent = {
  id: string;
  owner_user_id: string;
  account_id: string | null;
  calendar_id: string | null;
  event_id: string;
  title: string;
  location: string | null;
  start_at: string;
  end_at: string | null;
  all_day: boolean;
  created_at: string;
};

export type UserSettings = {
  user_id: string;
  default_view: "day" | "week" | "month";
  home_page: string;
  agenda_view: "day" | "week" | "month";
  handwriting_enabled: boolean;
  pomo_work: number;
  pomo_short: number;
  pomo_long: number;
  pomo_rounds: number;
  pomo_autostart: boolean;
  mobile_nav: string[];
};
