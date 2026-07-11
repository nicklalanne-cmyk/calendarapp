"use client";

import { createClient } from "@/lib/supabase/client";
import { CalendarClock } from "lucide-react";

export default function LoginPage() {
  const signIn = async () => {
    const supabase = createClient();
    const origin = window.location.origin;
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${origin}/auth/callback` },
    });
  };

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-sm text-center">
        <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/20">
          <CalendarClock className="h-7 w-7 text-accent" />
        </div>
        <h1 className="text-2xl font-semibold">Cadence</h1>
        <p className="mt-2 text-txt2">
          Your calendar, tasks, and notes — time-blocked into one calm day.
        </p>
        <button
          onClick={signIn}
          className="mt-8 flex w-full items-center justify-center gap-3 rounded-xl bg-white px-4 py-3 font-medium text-black transition hover:bg-white/90"
        >
          <GoogleMark />
          Continue with Google
        </button>
        <p className="mt-4 text-xs text-txt3">
          Sign in with any Google account. You can connect calendars from other accounts inside.
        </p>
      </div>
    </main>
  );
}

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.9-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.17 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}
