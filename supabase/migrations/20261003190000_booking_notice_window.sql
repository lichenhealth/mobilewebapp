-- Calendly parity, piece one (founder 2026-10-03: "can you audit calendly and
-- build out its features in our calendar?"): MINIMUM NOTICE + BOOKING WINDOW
-- per session type.
--   min_notice_min  — a booking can't start sooner than this many minutes
--                     from now (default 60, the rule the client had hardcoded
--                     for today-only — which leaked across midnight).
--   max_days_out    — how far ahead people may book; null = no limit.
-- Enforced where it can't be forgotten: a BEFORE INSERT trigger on bookings
-- (the page_versions lesson — rules live in triggers, not call sites), so
-- create_booking AND guest_create_booking are both covered without touching
-- either. "Now" is measured in the PROVIDER's timezone when the comparison
-- needs a local date (minutes are tz-naive by doctrine).

alter table public.booking_types
  add column if not exists min_notice_min integer not null default 60,
  add column if not exists max_days_out integer;

alter table public.booking_types
  drop constraint if exists booking_types_notice_range,
  add constraint booking_types_notice_range
    check (min_notice_min >= 0 and min_notice_min <= 20160);
alter table public.booking_types
  drop constraint if exists booking_types_window_range,
  add constraint booking_types_window_range
    check (max_days_out is null or (max_days_out >= 1 and max_days_out <= 365));

create or replace function public.enforce_booking_notice()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $func$
declare
  t record;
  v_now timestamp;
  v_slot timestamp;
begin
  select bt.min_notice_min, bt.max_days_out, p.timezone
    into t
    from public.booking_types bt
    left join public.profiles p on p.id = bt.profile_id
   where bt.id = new.type_id;
  if not found then return new; end if;

  -- The provider's local clock; a bad/unknown timezone falls back to UTC
  -- rather than failing the booking.
  begin
    v_now := now() at time zone coalesce(nullif(t.timezone, ''), 'UTC');
  exception when others then
    v_now := now() at time zone 'UTC';
  end;

  v_slot := new.on_date::timestamp + make_interval(mins => new.start_min);

  if v_slot < v_now + make_interval(mins => coalesce(t.min_notice_min, 0)) then
    raise exception 'That time is too soon — this session needs more notice. Pick a later slot.';
  end if;

  if t.max_days_out is not null
     and new.on_date > (v_now::date + t.max_days_out) then
    raise exception 'That date is further out than this session type allows yet.';
  end if;

  return new;
end;
$func$;

drop trigger if exists booking_notice_window on public.bookings;
create trigger booking_notice_window
  before insert on public.bookings
  for each row execute function public.enforce_booking_notice();

-- The boards carry the rules out to the slot pickers (member + guest alike),
-- so the client can hide too-soon / too-far slots instead of letting the
-- trigger bounce them. Bodies verbatim from the live DB, 'type' gaining the
-- two fields.

create or replace function public.booking_board(p_type uuid, p_from date, p_to date)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $func$
declare t record; v jsonb;
begin
  if not public.booking_type_visible(p_type, auth.uid()) then
    return null;
  end if;
  select * into t from public.booking_types where id = p_type;
  select jsonb_build_object(
    'type', jsonb_build_object(
      'id', t.id, 'provider_id', t.profile_id, 'title', t.title,
      'description', t.description, 'duration_min', t.duration_min,
      'buffer_min', t.buffer_min, 'price', t.price, 'location', t.location,
      'approval', t.approval,
      'min_notice_min', t.min_notice_min, 'max_days_out', t.max_days_out),
    'windows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'weekday', w.weekday, 'start_min', w.start_min, 'end_min', w.end_min,
        'valid_from', w.valid_from, 'valid_to', w.valid_to))
      from public.availability_windows w
      where w.profile_id = t.profile_id and w.kind = 'available'), '[]'::jsonb),
    'busy', coalesce((
      select jsonb_agg(b) from (
        select e.start_date, e.end_date, e.all_day, e.start_min, e.end_min, e.recurrence
        from public.events e
        where (e.owner_profile_id = t.profile_id
               or exists (select 1 from public.event_attendees a
                          where a.event_id = e.id and a.profile_id = t.profile_id
                            and a.status <> 'declined'))
          and e.start_date <= p_to and (e.end_date >= p_from or e.recurrence is not null)
        union all
        select x.on_date, x.on_date, x.all_day, x.start_min, x.end_min, null::jsonb
        from public.external_busy x
        where x.profile_id = t.profile_id and x.on_date between p_from and p_to
        union all
        select bk.on_date, bk.on_date, false, bk.start_min, bk.end_min, null::jsonb
        from public.bookings bk
        where bk.provider_id = t.profile_id
          and bk.status in ('pending', 'confirmed')
          and bk.on_date between p_from and p_to
      ) b), '[]'::jsonb)
  ) into v;
  return v;
end; $func$;

create or replace function public.public_booking_board(p_type uuid, p_from date, p_to date)
returns jsonb
language sql
stable security definer
set search_path to 'public'
as $func$
  select jsonb_build_object(
    'type', jsonb_build_object(
      'id', t.id, 'provider_id', t.profile_id, 'title', t.title,
      'description', t.description, 'duration_min', t.duration_min,
      'buffer_min', t.buffer_min, 'price', t.price, 'location', t.location,
      'approval', t.approval,
      'min_notice_min', t.min_notice_min, 'max_days_out', t.max_days_out),
    'windows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'weekday', w.weekday, 'start_min', w.start_min, 'end_min', w.end_min,
        'valid_from', w.valid_from, 'valid_to', w.valid_to))
      from public.availability_windows w
      where w.profile_id = t.profile_id and w.kind = 'available'), '[]'::jsonb),
    'busy', coalesce((
      select jsonb_agg(x) from (
        select e.start_date, e.end_date, e.all_day, e.start_min, e.end_min, e.recurrence
        from public.events e
        where (e.owner_profile_id = t.profile_id
               or exists (select 1 from public.event_attendees a
                          where a.event_id = e.id and a.profile_id = t.profile_id and a.status <> 'declined'))
          and e.start_date <= p_to and (e.end_date >= p_from or e.recurrence is not null)
        union all
        select b.on_date, b.on_date, false, b.start_min, b.end_min, null::jsonb
        from public.bookings b
        where b.provider_id = t.profile_id and b.status in ('pending', 'confirmed')
          and b.on_date between p_from and p_to
        union all
        select xb.on_date, xb.on_date, xb.all_day, xb.start_min, xb.end_min, null::jsonb
        from public.external_busy xb
        where xb.profile_id = t.profile_id and xb.on_date between p_from and p_to
      ) x), '[]'::jsonb))
  from public.booking_types t
  where t.id = p_type and t.active and t.audience = 'public';
$func$;
