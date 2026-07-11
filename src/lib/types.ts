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
  updated_at: string;
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
  source: "google";
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
};
