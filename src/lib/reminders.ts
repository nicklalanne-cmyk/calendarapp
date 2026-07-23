/** Shared "remind me" lead-time presets, matching Google Calendar's own
 * reminder time picker — used by both the task and event modals so the
 * dropdown looks and behaves the same everywhere. `null` means no reminder;
 * `0` means "at the time of the event/task". */
export const REMINDER_OPTIONS: { value: number | null; label: string }[] = [
  { value: null, label: "None" },
  { value: 0, label: "At time of event" },
  { value: 5, label: "5 minutes before" },
  { value: 10, label: "10 minutes before" },
  { value: 15, label: "15 minutes before" },
  { value: 30, label: "30 minutes before" },
  { value: 60, label: "1 hour before" },
  { value: 120, label: "2 hours before" },
  { value: 1440, label: "1 day before" },
  { value: 2880, label: "2 days before" },
  { value: 10080, label: "1 week before" },
];
