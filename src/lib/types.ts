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
};
