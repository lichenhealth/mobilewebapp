-- DRAFT EVENTS HOLD YOUR TIME + PER-EVENT CALENDAR VISIBILITY
-- (founder 2026-11-09: "Drafts should show up on cal as well and block your
-- time, if they've chosen the time and want it added to cal, which should be
-- the default on. And you can specify event visibility - who sees the
-- details, who sees busy, who can't see your availability at all, just like
-- calendar items").
--
-- A draft event with a time becomes a real events row with is_draft=true,
-- tied to its post_drafts row by draft_id ON DELETE CASCADE — posting (which
-- deletes the draft row) or deleting the draft removes the hold by itself.
-- It has no post and no attendees, so only its owner can read it; free_busy
-- and the booking boards see it as busy like any owned event.
--
-- share_level is the event's OWN cap over the owner's calendar sharing rules:
-- null = follow calendar sharing (details/busy/hidden by audience, as now);
-- 'busy' = never more than busy to anyone; 'hidden' = never shown to anyone
-- else (it still blocks your own bookable time). A draft is always capped at
-- busy — an unpublished title never reaches another member's calendar.

alter table public.events add column if not exists is_draft boolean not null default false;
alter table public.events add column if not exists draft_id uuid references public.post_drafts(id) on delete cascade;
alter table public.events add column if not exists share_level text;
do $c$ begin
  alter table public.events add constraint events_share_level_chk check (share_level is null or share_level in ('busy','hidden'));
exception when duplicate_object then null; end $c$;
create unique index if not exists events_draft_id_uidx on public.events(draft_id) where draft_id is not null;

CREATE OR REPLACE FUNCTION public.free_busy(p_profiles uuid[], p_from date, p_to date)
 RETURNS TABLE(profile_id uuid, level text, start_date date, end_date date, all_day boolean, start_min smallint, end_min smallint, recurrence jsonb, title text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with lv as (
    select p as owner, public.calendar_level(p, auth.uid()) as level
    from unnest(p_profiles) as p
  ),
  owned as (
    select l.owner,
      case
        when l.owner = auth.uid() then l.level
        when e.share_level = 'hidden' then 'hidden'
        when (e.is_draft or e.share_level = 'busy') and l.level = 'details' then 'busy'
        else l.level
      end as level,
      e.start_date, e.end_date, e.all_day, e.start_min, e.end_min, e.recurrence, e.title, e.id
    from lv l join public.events e on e.owner_profile_id = l.owner
    where l.level <> 'hidden'
  ),
  attending as (
    select l.owner, l.level,
      e.start_date, e.end_date, e.all_day, e.start_min, e.end_min, e.recurrence, e.title, e.id
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
  where level <> 'hidden'
    and start_date <= p_to and (end_date >= p_from or recurrence is not null)
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
$function$;
