-- SEND TO THEIR CALENDAR (founder 2026-11-13: "I want to invite outside synced
-- calendars to Events - in this case, my google cal, so gabe can see the vet
-- visit for our dog… the on platform/off platform ease that we're trying to
-- build is everywhere" → "yes, build the send-to-their-calendar invite").
--
-- A calendar event's host can email each invitee a REAL calendar invitation
-- (an iTIP METHOD:REQUEST .ics) that lands in Google / Apple / Outlook with
-- Yes / No / Maybe — members (their email resolved server-side, never shown
-- to the host) and off-Lichen email addresses alike. The send-calendar-invite
-- edge fn writes these rows (service role) so an edit can re-send as an
-- UPDATE and a delete can send a CANCEL to the same people.

create table if not exists public.event_calendar_sends (
  event_id uuid not null references public.events(id) on delete cascade,
  email text not null,
  profile_id uuid references public.profiles(id) on delete set null,
  sent_at timestamptz not null default now(),
  primary key (event_id, email)
);

alter table public.event_calendar_sends enable row level security;

-- Hosts see WHO got one (names for members; the raw email only for the
-- addresses the host typed — a member's own email is never exposed: the
-- client reads profile_id for members and shows their name).
drop policy if exists "calendar sends: hosts read" on public.event_calendar_sends;
create policy "calendar sends: hosts read" on public.event_calendar_sends
  for select using (public.is_event_host(event_id, auth.uid()));

revoke all on public.event_calendar_sends from anon;
grant select on public.event_calendar_sends to authenticated;

-- A member's email must never ride out through this table to the host.
-- Column-scoped grant: hosts read event_id/profile_id/sent_at, and email
-- only arrives via the view below (null for member rows).
revoke select on public.event_calendar_sends from authenticated;
grant select (event_id, profile_id, sent_at) on public.event_calendar_sends to authenticated;

-- The view reads `email`, which authenticated can't select directly — so it
-- runs as its owner, with the host check written into its WHERE.
drop view if exists public.event_calendar_send_list;
create view public.event_calendar_send_list as
  select event_id, profile_id, sent_at,
         case when profile_id is null then email end as email
  from public.event_calendar_sends s
  where public.is_event_host(s.event_id, auth.uid());
revoke all on public.event_calendar_send_list from anon;
grant select on public.event_calendar_send_list to authenticated;

-- RFC 5545 SEQUENCE: every update or cancel bumps it so calendars replace
-- the earlier copy instead of duplicating it.
alter table public.events add column if not exists ical_sequence integer not null default 0;
