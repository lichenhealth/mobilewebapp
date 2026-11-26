-- OPEN IN SAFARI, STILL SIGNED IN (founder 2026-11-26: the iPhone home-screen
-- app can't listen, so voice features hand off to Safari/Chrome — "so that it
-- feels seamless"). The home-screen app and the browser keep separate
-- logins; a one-time code (3 minutes, single use) carries a fresh sign-in
-- across. Only the voice-handoff edge function (service role) touches this.
create table if not exists public.session_handoffs (
  code text primary key,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  token_hash text not null,
  created_at timestamptz not null default now(),
  used_at timestamptz
);
alter table public.session_handoffs enable row level security;
revoke all on public.session_handoffs from anon, authenticated;
