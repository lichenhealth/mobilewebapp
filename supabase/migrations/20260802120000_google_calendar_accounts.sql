-- Google Calendar OAuth connections (one-tap import; founder go-ahead 2026-07-17).
-- Stores refresh tokens SERVER-SIDE ONLY: RLS is enabled with NO policies, so
-- no client can ever read a token — the edge functions use the service role.
-- The visible face of a connection is a normal external_calendars row whose
-- url is 'google:<account id>'; deleting that row is the member's gesture,
-- and google-oauth-start's disconnect action removes the token with it.

create table public.google_calendar_accounts (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  google_email text,
  refresh_token text not null,
  created_at timestamptz not null default now()
);

alter table public.google_calendar_accounts enable row level security;
-- Deliberately NO policies: deny-all for every client role.
