-- IMPORTED CALENDARS GET FULL AUDIENCE RULES (founder design-clean, 2026-07-19):
-- "My Lichen calendar" and each imported calendar now carry the SAME rule
-- machinery — as many rules as you like, per person/group/community/org/place,
-- at Nothing / Busy times / Full details. calendar_shares gains a nullable
-- external_calendar_id (null = the Lichen calendar, as before).
--
-- Resolution for an imported calendar's viewer:
--   1. Its own rules (person beats space beats everyone — the same ladder).
--   2. No rule speaks → follow the Lichen calendar's level, CAPPED at busy
--      (outside-life titles never leak through general rules).
-- This supersedes the share_titles toggle (PR #108) — dropped below.

alter table public.calendar_shares
  add column external_calendar_id uuid references public.external_calendars(id) on delete cascade;

-- one rule per audience PER CALENDAR
drop index if exists calendar_shares_audience_uniq;
create unique index calendar_shares_audience_uniq
  on public.calendar_shares (
    owner_id, audience_type,
    coalesce(audience_space_id,      '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(audience_profile_id,    '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(external_calendar_id,   '00000000-0000-0000-0000-000000000000'::uuid)
  );

-- The Lichen calendar's resolver must ignore imported-calendar rules.
create or replace function public.calendar_level(p_owner uuid, p_viewer uuid)
returns text language plpgsql stable security definer set search_path to 'public' as $$
declare v text;
begin
  if p_owner = p_viewer then return 'details'; end if;

  select level into v from public.calendar_shares
   where owner_id = p_owner and external_calendar_id is null
     and audience_type = 'profile' and audience_profile_id = p_viewer;
  if v is not null then return v; end if;

  select level into v
  from public.calendar_shares s
  where s.owner_id = p_owner and s.external_calendar_id is null
    and s.audience_type = 'space'
    and public.is_space_member(s.audience_space_id, p_owner)
    and public.is_space_member(s.audience_space_id, p_viewer)
  order by case s.level when 'details' then 2 when 'busy' then 1 else 0 end desc
  limit 1;
  if v is not null then return v; end if;

  select level into v from public.calendar_shares
   where owner_id = p_owner and external_calendar_id is null and audience_type = 'everyone';
  return coalesce(v, 'busy');
end; $$;

-- An imported calendar's own ladder — NULL when none of its rules speak
-- (the caller falls back to the Lichen level, capped at busy).
create or replace function public.external_calendar_level(p_cal uuid, p_owner uuid, p_viewer uuid)
returns text language plpgsql stable security definer set search_path to 'public' as $$
declare v text;
begin
  if p_owner = p_viewer then return 'details'; end if;

  select level into v from public.calendar_shares
   where owner_id = p_owner and external_calendar_id = p_cal
     and audience_type = 'profile' and audience_profile_id = p_viewer;
  if v is not null then return v; end if;

  select level into v
  from public.calendar_shares s
  where s.owner_id = p_owner and s.external_calendar_id = p_cal
    and s.audience_type = 'space'
    and public.is_space_member(s.audience_space_id, p_owner)
    and public.is_space_member(s.audience_space_id, p_viewer)
  order by case s.level when 'details' then 2 when 'busy' then 1 else 0 end desc
  limit 1;
  if v is not null then return v; end if;

  select level into v from public.calendar_shares
   where owner_id = p_owner and external_calendar_id = p_cal and audience_type = 'everyone';
  return v;
end; $$;
alter function public.external_calendar_level(uuid, uuid, uuid) owner to postgres;

-- free_busy: each imported block resolves through ITS calendar's rules first;
-- a calendar-specific grant can even show through a hidden Lichen calendar,
-- and a calendar-specific 'hidden' hides it from an otherwise-visible one.
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
  select l.owner, lvx.level, b.on_date, b.on_date, b.all_day,
         b.start_min::smallint, b.end_min::smallint, null::jsonb,
         case when lvx.level = 'details' then b.title else null end
  from lv l
  join public.external_busy b on b.profile_id = l.owner
  join public.external_calendars c on c.id = b.calendar_id
  cross join lateral (
    select coalesce(
      public.external_calendar_level(c.id, l.owner, auth.uid()),
      case when l.level = 'hidden' then 'hidden' else 'busy' end
    ) as level
  ) lvx
  where lvx.level <> 'hidden'
    and b.on_date between p_from and p_to;
$$;

-- Superseded by per-calendar rules (PR #108's binary toggle; no live data).
alter table public.external_calendars drop column if exists share_titles;
