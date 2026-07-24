-- EXTERNAL EVENT GUESTS (founder 2026-07-23): invite people outside Lichen to an
-- event you host. Lichen emails them a tokenized link; the token authorizes that
-- one event (so it works even for private events). No account needed — they can
-- add it to their own calendar, RSVP as a guest, or make an account (landing in
-- the 3-month growth gift, no paywall).

create table public.event_guests (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  invited_by uuid not null references public.profiles(id) on delete cascade,
  email text not null,
  name text not null,
  token text not null unique default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  status text not null default 'invited' check (status in ('invited', 'going', 'tentative', 'declined')),
  created_at timestamptz not null default now()
);
alter table public.event_guests enable row level security;
-- The host manages their event's guest invites. Guests themselves have no
-- account — they read/RSVP via the SECURITY DEFINER RPCs below (token = auth).
create policy event_guests_host on public.event_guests for all
  using (invited_by = auth.uid()) with check (invited_by = auth.uid());
create index event_guests_event on public.event_guests (event_id, invited_by);

-- Guest reads the event by token (no account). Definer bypasses event RLS — the
-- unguessable token IS the authorization. Flat summary, titles included.
create or replace function public.guest_event(p_token text)
returns table (
  guest_name text, guest_status text,
  title text, description text, location text,
  start_date date, end_date date, all_day boolean, start_min smallint, end_min smallint,
  recurrence jsonb, host_name text
) language sql security definer set search_path = public stable as $fn$
  select g.name, g.status, e.title, e.description, e.location,
         e.start_date, e.end_date, e.all_day, e.start_min, e.end_min, e.recurrence,
         coalesce(sp.name, pr.full_name, 'A member')
  from public.event_guests g
  join public.events e on e.id = g.event_id
  left join public.profiles pr on pr.id = e.owner_profile_id
  left join public.spaces sp on sp.id = e.owner_space_id
  where g.token = p_token;
$fn$;
grant execute on function public.guest_event(text) to anon, authenticated;

-- Guest RSVPs by token (no account).
create or replace function public.guest_rsvp(p_token text, p_status text)
returns void language plpgsql security definer set search_path = public as $fn$
begin
  if p_status not in ('going', 'tentative', 'declined') then return; end if;
  update public.event_guests set status = p_status where token = p_token;
end $fn$;
grant execute on function public.guest_rsvp(text, text) to anon, authenticated;
