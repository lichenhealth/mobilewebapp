-- IMPORTED CALENDARS CAN JOIN "FULL DETAILS" (founder + Gabe, 2026-07-19):
-- so Lichen can be someone's PRIMARY calendar, an imported calendar may opt
-- in to sharing its titles — but only with viewers the member ALREADY grants
-- 'details' via their sharing rules. Default stays false: imported titles
-- are owner-only unless the member flips this per calendar. (Outside-life
-- titles weren't authored for an audience — opting in is a per-calendar
-- consent, never a side effect.)

alter table public.external_calendars
  add column share_titles boolean not null default false;

-- free_busy: imported rows now carry a title ONLY when (a) that calendar
-- opted in and (b) this viewer's resolved level is 'details'. Everyone else
-- keeps seeing plain busy blocks. Everything else unchanged.
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
         b.start_min::smallint, b.end_min::smallint, null::jsonb,
         case when l.level = 'details' and c.share_titles then b.title else null end
  from lv l
  join public.external_busy b on b.profile_id = l.owner
  join public.external_calendars c on c.id = b.calendar_id
  where l.level <> 'hidden'
    and b.on_date between p_from and p_to;
$$;
