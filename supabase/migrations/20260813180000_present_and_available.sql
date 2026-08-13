-- TWO TIERS: PRESENT, AND AVAILABLE (founder 2026-08-13).
--
-- Presence can only ever say "here this minute", and the founder wants the
-- opposite of app-stickiness: "I just want people to be offline as much as
-- possible, but be able to signal when they're available." Those are two
-- different claims, so they become two signals:
--
--   PRESENT   — candle lit and a heartbeat in the last 5 minutes. Unchanged.
--   AVAILABLE — inside your published availability hours, minus what's booked.
--               Asks nothing of you at the time: set your hours, close the
--               app, go live your life.
--
-- AND THE WORD "AWAKE" RETIRES. Founder: "it sounds a bit off, like either
-- they're enlightened, or they're sleeping when not on Lichen, which is not
-- the case." The four functions keep their bodies and get honest names. The
-- old names are DROPPED rather than aliased — two names for one thing is how
-- drift starts, and every caller lives in this repo.

-- ── Present: the same four, renamed ─────────────────────────────────────────

drop function if exists public.network_awake_count();
drop function if exists public.network_awake_list();
drop function if exists public.space_awake_count(uuid);
drop function if exists public.space_awake_list(uuid);

create or replace function public.network_present_count()
returns integer language sql stable security definer set search_path = 'public' as $func$
  select count(distinct p.id)::int
  from public.profiles p
  where p.id <> auth.uid()
    and (p.presence_always_present or p.presence_lit_until > now())
    and p.last_seen_at > now() - interval '5 minutes'
    and (
      p.id in (select m.target_id from public.mycelium m
               where m.truster_id = auth.uid() and m.target_type = 'profile')
      or p.id in (select m2.profile_id
                  from public.space_members m1
                  join public.space_members m2 on m2.space_id = m1.space_id
                  where m1.profile_id = auth.uid())
    );
$func$;

create or replace function public.network_present_list()
returns table(id uuid, full_name text, avatar_url text, headline text, lit boolean)
language sql stable security definer set search_path = 'public' as $func$
  select distinct p.id, p.full_name, p.avatar_url, p.headline, true as lit
  from public.profiles p
  where p.id <> auth.uid()
    and (p.presence_always_present or p.presence_lit_until > now())
    and p.last_seen_at > now() - interval '5 minutes'
    and (
      p.id in (select m.target_id from public.mycelium m
               where m.truster_id = auth.uid() and m.target_type = 'profile')
      or p.id in (select m2.profile_id
                  from public.space_members m1
                  join public.space_members m2 on m2.space_id = m1.space_id
                  where m1.profile_id = auth.uid())
    )
  order by p.full_name;
$func$;

create or replace function public.space_present_count(p_space uuid)
returns integer language sql stable security definer set search_path = 'public' as $func$
  select case
    when not exists (
      select 1 from public.space_members me
      where me.space_id = p_space and me.profile_id = auth.uid()
    ) then 0
    else (
      select count(distinct p.id)::int
      from public.profiles p
      join public.space_members m on m.profile_id = p.id and m.space_id = p_space
      where (p.presence_always_present or p.presence_lit_until > now())
        and p.last_seen_at > now() - interval '5 minutes'
    )
  end;
$func$;

create or replace function public.space_present_list(p_space uuid)
returns table(id uuid, full_name text, avatar_url text, headline text, lit boolean, me boolean)
language sql stable security definer set search_path = 'public' as $func$
  select distinct p.id, p.full_name, p.avatar_url, p.headline,
         true as lit,
         (p.id = auth.uid()) as me
  from public.profiles p
  join public.space_members m on m.profile_id = p.id and m.space_id = p_space
  where (p.presence_always_present or p.presence_lit_until > now())
    and p.last_seen_at > now() - interval '5 minutes'
    and exists (
      select 1 from public.space_members me2
      where me2.space_id = p_space and me2.profile_id = auth.uid()
    )
  order by p.full_name;
$func$;

-- ── A third kind of hours: SOCIAL ───────────────────────────────────────────
--
-- Founder 2026-08-13: "I might want therapy sessions to show up as available
-- 9-5, but I'm available 10-7 for social hours, with any booked therapy hours
-- auto making me unavailable."
--
-- So the hours you'd take a booking in and the hours you'd welcome a chat in
-- are different hours, and conflating them makes both a lie. kind already
-- carried 'available' (work, bookable) and 'on_call' (the care rota); this
-- adds 'social'. It's a text column with a CHECK, not a Postgres enum, so the
-- value is usable the moment the CHECK changes — no separate commit needed.
--
-- HOME COUNTS SOCIAL ONLY (founder's call): work hours stay a booking
-- concern and never reach the greeting. Home is for connection, not commerce.

alter table public.availability_windows
  drop constraint if exists availability_windows_kind_check,
  add constraint availability_windows_kind_check
    check (kind = any (array['available'::text, 'social'::text, 'on_call'::text]));

comment on column public.availability_windows.kind is
  'available = work hours, bookable. social = hours you welcome a chat in; this is what Home''s "N are available" counts. on_call = the care rota (Concierge), deliberately not subtracted by bookings.';

-- ── Available: in your published SOCIAL hours, in YOUR timezone ─────────────
--
-- Returns CANDIDATES. What's booked is subtracted client-side by
-- presenceApi.availableList(), because recurrence lives in exactly one place
-- (src/lib/recurrence.ts, shared by the calendar, reminders and the
-- fire-reminders edge function) and writing a second expander in SQL would
-- fork the engine — the drift the single-engine rule exists to prevent. The
-- candidate set is small (only people currently in-hours), so the client's
-- free_busy() pass over it is cheap.
--
-- THREE RULES:
--   * The window is matched in the MEMBER's own timezone (profiles.timezone,
--     stamped by the presence heartbeat). Hours mean nothing otherwise: 9–5
--     is 9–5 where they are, not where the viewer is.
--   * Availability is NOT public. It follows the calendar ladder via
--     calendar_level(), exactly as availability_of() already does — published
--     hours reach only the people allowed to see them.
--   * PRESENT WINS. The tiers are disjoint, so "two present and three
--     available" is five different people rather than a confusing overlap.

drop function if exists public.network_available_list();
create or replace function public.network_available_list()
returns table(id uuid, full_name text, avatar_url text, headline text,
              local_date date, local_min smallint)
language sql stable security definer set search_path = 'public' as $func$
  with local_now as (
    select p.id,
           (now() at time zone coalesce(nullif(p.timezone, ''), 'UTC')) as lt
    from public.profiles p
  )
  -- local_date / local_min come back so the client can subtract what's booked
  -- in the MEMBER's own frame rather than the viewer's — 2pm busy means 2pm
  -- where they are. It leaks nothing their being in-hours doesn't already imply.
  select distinct p.id, p.full_name, p.avatar_url, p.headline,
         ln.lt::date as local_date,
         (extract(hour from ln.lt) * 60 + extract(minute from ln.lt))::smallint as local_min
  from public.profiles p
  join local_now ln on ln.id = p.id
  join public.availability_windows w on w.profile_id = p.id
  where p.id <> auth.uid()
    and w.kind = 'social'
    and extract(dow from ln.lt)::smallint = w.weekday
    and (extract(hour from ln.lt) * 60 + extract(minute from ln.lt))
          between w.start_min and w.end_min
    and (w.valid_from is null or ln.lt::date >= w.valid_from)
    and (w.valid_to   is null or ln.lt::date <= w.valid_to)
    -- Their calendar has to be visible to you at all.
    and public.calendar_level(p.id, auth.uid()) <> 'hidden'
    -- Present outranks available; never count someone twice.
    and not ((p.presence_always_present or p.presence_lit_until > now())
             and p.last_seen_at > now() - interval '5 minutes')
    -- The same web as presence: your mycelium, plus people you share a space with.
    and (
      p.id in (select m.target_id from public.mycelium m
               where m.truster_id = auth.uid() and m.target_type = 'profile')
      or p.id in (select m2.profile_id
                  from public.space_members m1
                  join public.space_members m2 on m2.space_id = m1.space_id
                  where m1.profile_id = auth.uid())
    )
  order by p.full_name;
$func$;

revoke all on function public.network_available_list() from public, anon;
grant execute on function public.network_available_list() to authenticated;
