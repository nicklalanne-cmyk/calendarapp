-- Cadence schema. Run this in the Supabase SQL editor.

-- TASKS ---------------------------------------------------------------
create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null,
  notes text,
  is_done boolean not null default false,
  due_date date,
  scheduled_start timestamptz,
  scheduled_end timestamptz,
  google_event_id text,
  created_at timestamptz not null default now()
);
alter table public.tasks enable row level security;

drop policy if exists "tasks are owned by user" on public.tasks;
create policy "tasks are owned by user" on public.tasks
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- NOTES ---------------------------------------------------------------
create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null default '',
  body text not null default '',
  updated_at timestamptz not null default now()
);
alter table public.notes enable row level security;

drop policy if exists "notes are owned by user" on public.notes;
create policy "notes are owned by user" on public.notes
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- GOOGLE CREDENTIALS --------------------------------------------------
create table if not exists public.google_credentials (
  user_id uuid primary key references auth.users (id) on delete cascade,
  refresh_token text not null,
  updated_at timestamptz not null default now()
);
alter table public.google_credentials enable row level security;

drop policy if exists "google creds are owned by user" on public.google_credentials;
create policy "google creds are owned by user" on public.google_credentials
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index if not exists tasks_user_idx on public.tasks (user_id, created_at desc);
create index if not exists notes_user_idx on public.notes (user_id, updated_at desc);

-- Multi-account Google calendar connections (added in the multi-account update).
create table if not exists public.google_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  google_email text not null,
  refresh_token text not null,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id, google_email)
);
alter table public.google_accounts enable row level security;
drop policy if exists "google accounts owned by user" on public.google_accounts;
create policy "google accounts owned by user" on public.google_accounts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index if not exists google_accounts_user_idx on public.google_accounts (user_id, created_at);
