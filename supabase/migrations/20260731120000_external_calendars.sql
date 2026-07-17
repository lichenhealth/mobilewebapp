-- External calendar import (calendar thread 7a — "part 4"; founder go-ahead 2026-07-17).
-- A member pastes their calendar's SECRET iCal URL (Google / Apple / Outlook all
-- offer one). The sync-external-calendar edge function fetches it, expands the
-- events into concrete per-day busy blocks in the member's own timezone, and
-- writes them here. free_busy() unions these blocks in, so external busy time
-- flows into find-a-time, on-call planning, and the upcoming booking feature.
-- Titles are stored for the OWNER's own calendar view but NEVER leave via
-- free_busy — other members only ever see "busy".

create table public.external_calendars (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  name text not null default 'Calendar',
  url text not null,
  timezone text,
  last_synced_at timestamptz,
  last_error text,
  event_count integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.external_calendars enable row level security;

create policy "own external calendars" on public.external_calendars
  for all to authenticated
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

create table public.external_busy (
  id uuid primary key default gen_random_uuid(),
  calendar_id uuid not null references public.external_calendars(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  on_date date not null,
  all_day boolean not null default false,
  start_min integer,
  end_min integer,
  title text
);

alter table public.external_busy enable row level security;

create policy "own external busy" on public.external_busy
  for all to authenticated
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

create index external_busy_profile_date on public.external_busy (profile_id, on_date);
create index external_busy_calendar on public.external_busy (calendar_id);

-- free_busy() gains a third source: imported busy blocks. Same per-viewer
-- privacy gate (calendar_level; hidden stays hidden); imported rows never
-- carry a title regardless of level — external events are busy-only to
-- everyone but their owner.
create or replace function public.free_busy(p_profiles uuid[], p_from date, p_to date)
returns table(profile_id uuid, level text, start_date date, end_date date, all_day boolean, start_min smallint, end_min smallint, recurrence jsonb, title text)
language sql stable security definer
set search_path to 'public'
as $$
  with lv as (
    select p as owner, public.calendar_level(p, auth.uid()) as level
    from unnest(p_profiles) as p
  ),
  owned as (
    select l.owner, l.level, e.*
    from lv l join public.events e on e.owner_profile_id = l.owner
    where l.level <> 'hidden'
  ),
  attending as (
    select l.owner, l.level, e.*
    from lv l
    join public.event_attendees a on a.profile_id = l.owner and a.status <> 'declined'
    join public.events e on e.id = a.event_id
    where l.level <> 'hidden'
  ),
  all_evts as (
    select distinct on (owner, id) * from (
      select * from owned union all select * from attending
    ) u
  )
  select owner, level, start_date, end_date, all_day, start_min, end_min, recurrence,
         case when level = 'details' then title else null end
  from all_evts
  where start_date <= p_to and (end_date >= p_from or recurrence is not null)
  union all
  select l.owner, l.level, b.on_date, b.on_date, b.all_day,
         b.start_min::smallint, b.end_min::smallint, null::jsonb, null::text
  from lv l
  join public.external_busy b on b.profile_id = l.owner
  where l.level <> 'hidden'
    and b.on_date between p_from and p_to;
$$;
