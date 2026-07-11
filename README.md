# Cadence (web)

A calm, Routine-style daily planner as an installable PWA — calendar with time-blocking, tasks, and notes in one place. Built on **Next.js 14 (App Router) + Supabase + Tailwind**, deploys on **Vercel**, and works on iOS and Android (add to home screen). Original design and assets; inspired by the Routine planner workflow.

This is **v1**: the core planner UI, tasks, notes, a Cmd+K command bar, and **two-way Google Calendar sync**.

---

## What's inside
- **Google sign-in** (Supabase Auth) requesting Calendar access.
- **Two-way Google Calendar sync** — day & week grid reads your primary calendar; create, edit, and delete events write straight back to Google.
- **Time-blocking** — drag a task from the sidebar onto the grid to turn it into a scheduled calendar event; drag on empty space to block out a new event.
- **Tasks** — add / complete / delete, stored in Supabase (per-user, row-level secured).
- **Notes** — fast typed notes with autosave.
- **Cmd+K / Ctrl+K command bar** for quick task capture.
- **Installable PWA** — manifest + service worker; add to home screen on iOS/Android.

---

## Prerequisites
- Node 18+ and npm
- A **Supabase** project (free tier is fine)
- A **Google Cloud** project (for the OAuth client + Calendar API)

---

## Setup

### 1. Install
```
npm install
cp .env.example .env.local   # then fill in the values below
```

### 2. Supabase
1. Create a project at supabase.com.
2. In **SQL Editor**, paste and run `supabase/schema.sql` (creates tasks, notes, google_credentials with RLS).
3. **Project Settings -> API**: copy the **Project URL** and **anon public key** into `.env.local`.

### 3. Google Cloud (OAuth + Calendar API)
1. **APIs & Services -> Library**: enable **Google Calendar API**.
2. **OAuth consent screen**: choose **External**, add your email as a **Test user**, and add the scope
   `https://www.googleapis.com/auth/calendar`. While the app is in "Testing", only your test users can sign in — perfect for personal use, no Google verification needed.
3. **Credentials -> Create credentials -> OAuth client ID -> Web application**. Add the
   **Authorized redirect URI:** `https://<your-project-ref>.supabase.co/auth/v1/callback`
   Copy the **Client ID** and **Client secret** into `.env.local`.

### 4. Connect Google in Supabase
1. **Authentication -> Providers -> Google**: enable, paste the same **Client ID** and **Client secret**.
2. **Authentication -> URL Configuration**:
   - **Site URL:** `http://localhost:3000` for dev (your Vercel URL in prod).
   - **Redirect URLs:** add `http://localhost:3000/auth/callback` (and later `https://YOUR-APP.vercel.app/auth/callback`).

### 5. Run
```
npm run dev
# open http://localhost:3000 -> Continue with Google -> grant Calendar access
```
On first sign-in Google asks for Calendar permission; Cadence stores the refresh token so it can sync.

---

## Deploy to Vercel
1. Push this folder to a new GitHub repo.
2. In Vercel, **Import** the repo.
3. Add the env vars from `.env.local` under **Project -> Settings -> Environment Variables**, and set
   `NEXT_PUBLIC_SITE_URL` to your Vercel URL.
4. Deploy, then add your production URL to **Supabase -> URL Configuration** (Site URL + `.../auth/callback` in Redirect URLs). The Google redirect URI stays the Supabase callback.

---

## Install as an app
- **iOS (Safari):** Share -> Add to Home Screen.
- **Android (Chrome):** menu -> Install app / Add to Home screen.

---

## Environment variables
| Variable | What it is |
|---|---|
| NEXT_PUBLIC_SUPABASE_URL | Supabase project URL |
| NEXT_PUBLIC_SUPABASE_ANON_KEY | Supabase anon public key |
| GOOGLE_CLIENT_ID | OAuth client ID (same one Supabase uses) |
| GOOGLE_CLIENT_SECRET | OAuth client secret |
| NEXT_PUBLIC_SITE_URL | Base URL (localhost in dev, Vercel URL in prod) |

---

## Notes & limits (v1)
- Moving/resizing events is done through the event's edit dialog for now (not yet drag-on-grid to reschedule).
- All-day events aren't drawn on the timed grid yet.
- iOS background push for reminders isn't included; that's a natural next step.
- The Google app stays in Testing mode for personal use; verification is only needed to let arbitrary users sign in.

## Roadmap toward a fuller Routine-style app
- Drag to move/resize events on the grid; overlapping-event layout.
- Recurring events, natural-language quick-add, keyboard-first navigation.
- Month view; multiple calendars; Outlook.
- Web push reminders + drive-time "leave now" alerts.
- Rich notes, projects, and task/calendar two-way edits.

---

## Project structure
```
src/app/            root + auth redirect, login, auth callback/signout
src/app/app/        protected planner (layout guards auth) + notes
src/app/api/google/ calendar list/create/update/delete
src/components/      AppShell, CommandBar, calendar grid + modal, tasks, notes
src/lib/supabase/    SSR auth clients + middleware
src/lib/google/      Calendar API + token refresh
supabase/schema.sql  database + RLS
public/              manifest, service worker, icons
```
