-- Calendly parity, pieces two through six (founder 2026-10-03: "build all 6
-- in the order you listed them"):
--   1. RESCHEDULE — reschedule_booking (member or provider) +
--      guest_reschedule_booking (token): revalidated like a fresh booking,
--      the linked calendar event moves with it, the other party is told.
--   2. REMINDERS — bookings.reminded_at + tick_booking_reminders() on
--      pg_cron every 10 min: inside the 24h before a confirmed session,
--      members get a bell (which rides push), guests get a reminder email
--      via send-booking-mail kind='reminder'.
--   3. (timezone display is client-only; the boards now carry provider_tz)
--   4. DAILY CAP — booking_types.max_per_day: at most N sessions of this
--      type per day (distinct start times, so joining a group session
--      never counts as a new one). Enforced in the same trigger as notice.
--   5. QUESTIONS — booking_types.questions (array of strings) asked at
--      booking; answers land in bookings.answers for the provider to read.
--   6. GROUP SESSIONS — booking_types.capacity (default 1): seats at the
--      same slot share ONE calendar event (attach/detach helpers), don't
--      conflict with each other, and the slot closes when full.
--      Round-robin (several providers rotating under one link) is
--      deliberately NOT built — booking_types are one-owner by design.

-- ── Schema ──────────────────────────────────────────────────────────────────

alter table public.booking_types
  add column if not exists max_per_day integer,
  add column if not exists capacity integer not null default 1,
  add column if not exists questions jsonb;

alter table public.booking_types
  drop constraint if exists booking_types_cap_range,
  add constraint booking_types_cap_range
    check (max_per_day is null or (max_per_day >= 1 and max_per_day <= 48));
alter table public.booking_types
  drop constraint if exists booking_types_capacity_range,
  add constraint booking_types_capacity_range
    check (capacity >= 1 and capacity <= 200);

alter table public.bookings
  add column if not exists answers jsonb,
  add column if not exists reminded_at timestamptz;

-- ── Notice + window + daily cap, one trigger (covers insert AND reschedule) ─

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
  v_held integer;
begin
  select bt.profile_id, bt.min_notice_min, bt.max_days_out, bt.max_per_day, p.timezone
    into t
    from public.booking_types bt
    left join public.profiles p on p.id = bt.profile_id
   where bt.id = new.type_id;
  if not found then return new; end if;

  -- The provider arranging their own calendar isn't bound by their own
  -- notice rules (they can already cancel at will).
  if auth.uid() = t.profile_id then return new; end if;

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

  -- Daily cap counts DISTINCT start times (joining a group session that's
  -- already on the books is never a new session).
  if t.max_per_day is not null then
    select count(distinct b.start_min) into v_held
      from public.bookings b
     where b.type_id = new.type_id and b.on_date = new.on_date
       and b.status in ('pending', 'confirmed')
       and b.id is distinct from new.id
       and b.start_min <> new.start_min;
    if v_held >= t.max_per_day then
      raise exception 'That day is fully booked for this session — pick another day.';
    end if;
  end if;

  return new;
end;
$func$;

drop trigger if exists booking_notice_window on public.bookings;
create trigger booking_notice_window
  before insert or update of on_date, start_min on public.bookings
  for each row execute function public.enforce_booking_notice();

-- ── Shared-event helpers (group sessions share ONE calendar block) ──────────
-- Internal: called only from the definer RPCs below; no client execute.

create or replace function public._booking_attach_event(p_booking uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $func$
declare b record; t record; v_event uuid; v_name text;
begin
  select * into b from public.bookings where id = p_booking;
  if b is null then return null; end if;
  select * into t from public.booking_types where id = b.type_id;

  -- A group slot reuses the seatmates' event instead of stacking duplicates
  -- on the provider's calendar.
  if t.capacity > 1 then
    select x.event_id into v_event
      from public.bookings x
     where x.type_id = b.type_id and x.on_date = b.on_date and x.start_min = b.start_min
       and x.id <> b.id and x.status = 'confirmed' and x.event_id is not null
     limit 1;
  end if;

  if v_event is null then
    if t.capacity <= 1 then
      select coalesce(
        (select full_name from public.profiles where id = b.booker_id),
        b.guest_name) into v_name;
    end if;
    insert into public.events (creator_id, owner_profile_id, title, description, location,
                               start_date, end_date, all_day, start_min, end_min)
    values (b.provider_id, b.provider_id,
            t.title || case when v_name is null then '' else ' — ' || v_name end,
            case when t.capacity > 1 then '' else coalesce(b.note, '') end,
            t.location, b.on_date, b.on_date, false, b.start_min, b.end_min)
    returning id into v_event;
  end if;

  if b.booker_id is not null then
    insert into public.event_attendees (event_id, profile_id, status, invited_by)
    values (v_event, b.booker_id, 'going', b.provider_id)
    on conflict do nothing;
  end if;

  update public.bookings set event_id = v_event where id = p_booking;
  return v_event;
end;
$func$;

create or replace function public._booking_detach_event(p_booking uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $func$
declare b record; v_others integer;
begin
  select * into b from public.bookings where id = p_booking;
  if b is null or b.event_id is null then return; end if;
  select count(*) into v_others
    from public.bookings x
   where x.event_id = b.event_id and x.id <> b.id
     and x.status in ('pending', 'confirmed');
  if v_others > 0 then
    -- Seatmates still hold the event — only this person steps out of it.
    if b.booker_id is not null then
      delete from public.event_attendees
       where event_id = b.event_id and profile_id = b.booker_id;
    end if;
  else
    delete from public.events where id = b.event_id;
  end if;
  update public.bookings set event_id = null where id = p_booking;
end;
$func$;

revoke all on function public._booking_attach_event(uuid) from public, anon, authenticated;
revoke all on function public._booking_detach_event(uuid) from public, anon, authenticated;

-- ── create_booking: answers + group seats (old signature dropped — one
--    PostgREST candidate) ────────────────────────────────────────────────────

drop function if exists public.create_booking(uuid, date, integer, text);

create function public.create_booking(
  p_type uuid, p_date date, p_start integer, p_note text default ''::text,
  p_answers jsonb default null)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $func$
declare t record; v_end integer; v_id uuid;
        v_booker_name text; v_weekday int; v_ok boolean; v_seats int;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if not public.booking_type_visible(p_type, auth.uid()) then
    raise exception 'This session isn''t open to you';
  end if;
  select * into t from public.booking_types where id = p_type;
  if t.profile_id = auth.uid() then raise exception 'That''s your own session type'; end if;
  v_end := p_start + t.duration_min;
  if v_end > 1440 then raise exception 'Slot runs past midnight'; end if;
  if p_date < current_date then raise exception 'That day has passed'; end if;
  if p_answers is not null and jsonb_typeof(p_answers) <> 'array' then p_answers := null; end if;
  if p_answers is not null and pg_column_size(p_answers) > 16384 then
    raise exception 'Answers are too long';
  end if;

  -- Inside a declared availability window? (weekday 0=Mon … 6=Sun)
  v_weekday := extract(isodow from p_date)::int - 1;
  select exists (
    select 1 from public.availability_windows w
    where w.profile_id = t.profile_id and w.kind = 'available'
      and w.weekday = v_weekday
      and w.start_min <= p_start and w.end_min >= v_end
      and (w.valid_from is null or w.valid_from <= p_date)
      and (w.valid_to is null or w.valid_to >= p_date)
  ) into v_ok;
  if not v_ok then raise exception 'That time isn''t offered'; end if;

  -- Group seats: the same type at the same slot isn't a conflict until full.
  if t.capacity > 1 then
    select count(*) into v_seats from public.bookings b
     where b.type_id = p_type and b.on_date = p_date and b.start_min = p_start
       and b.status in ('pending', 'confirmed');
    if v_seats >= t.capacity then
      raise exception 'This session is full — pick another time';
    end if;
    if exists (select 1 from public.bookings b
       where b.type_id = p_type and b.on_date = p_date and b.start_min = p_start
         and b.status in ('pending', 'confirmed') and b.booker_id = auth.uid()) then
      raise exception 'You''re already in this session';
    end if;
  end if;

  -- Conflicts: held bookings + non-recurring events + imported busy.
  -- (Recurring-event conflicts are filtered by the slot picker; request-mode
  -- approval is the human backstop.) Group seatmates and the group's own
  -- shared event are excluded — they ARE this slot.
  if exists (
    select 1 from public.bookings b
    where b.provider_id = t.profile_id and b.on_date = p_date
      and b.status in ('pending', 'confirmed')
      and b.start_min < v_end + t.buffer_min and b.end_min + t.buffer_min > p_start
      and not (t.capacity > 1 and b.type_id = p_type and b.start_min = p_start)
  ) or exists (
    select 1 from public.events e
    where e.owner_profile_id = t.profile_id and e.recurrence is null
      and p_date between e.start_date and e.end_date
      and (e.all_day or (coalesce(e.start_min, 0) < v_end + t.buffer_min
                         and coalesce(e.end_min, 1440) + t.buffer_min > p_start))
      and not (t.capacity > 1 and exists (
        select 1 from public.bookings lb
        where lb.event_id = e.id and lb.type_id = p_type))
  ) or exists (
    select 1 from public.external_busy x
    where x.profile_id = t.profile_id and x.on_date = p_date
      and (x.all_day or (coalesce(x.start_min, 0) < v_end + t.buffer_min
                         and coalesce(x.end_min, 1440) + t.buffer_min > p_start))
  ) then
    raise exception 'That slot was just taken — pick another';
  end if;

  insert into public.bookings (type_id, provider_id, booker_id, on_date, start_min, end_min, status, note, answers)
  values (p_type, t.profile_id, auth.uid(), p_date, p_start, v_end,
          case when t.approval = 'instant' then 'confirmed' else 'pending' end,
          coalesce(p_note, ''), p_answers)
  returning id into v_id;

  select full_name into v_booker_name from public.profiles where id = auth.uid();

  if t.approval = 'instant' then
    perform public._booking_attach_event(v_id);
    perform public.notify(t.profile_id, 'calendar', null, 'booking',
      coalesce(v_booker_name, 'A member') || ' booked ' || t.title,
      to_char(p_date, 'FMMon FMDD') || ' — it''s on your calendar.', '/bookings', auth.uid());
  else
    perform public.notify(t.profile_id, 'calendar', null, 'booking',
      coalesce(v_booker_name, 'A member') || ' requested ' || t.title,
      to_char(p_date, 'FMMon FMDD') || ' — accept or decline in Bookings.', '/bookings', auth.uid());
  end if;
  return v_id;
end;
$func$;

-- ── guest_create_booking: same additions ────────────────────────────────────

drop function if exists public.guest_create_booking(uuid, date, integer, text, text, text);

create function public.guest_create_booking(
  p_type uuid, p_date date, p_start integer, p_name text, p_email text,
  p_note text default ''::text, p_answers jsonb default null)
returns text
language plpgsql
security definer
set search_path to 'public'
as $func$
declare t record; v_end integer; v_id uuid; v_token text;
        v_weekday int; v_ok boolean; v_seats int;
begin
  select * into t from public.booking_types where id = p_type and active and audience = 'public';
  if t is null then raise exception 'This session isn''t open to the public'; end if;
  if btrim(coalesce(p_name, '')) = '' or p_email !~ '^\S+@\S+\.\S+$' then
    raise exception 'A name and a real email are how the confirmation reaches you';
  end if;
  v_end := p_start + t.duration_min;
  if v_end > 1440 then raise exception 'Slot runs past midnight'; end if;
  if p_date < current_date then raise exception 'That day has passed'; end if;
  if p_answers is not null and jsonb_typeof(p_answers) <> 'array' then p_answers := null; end if;
  if p_answers is not null and pg_column_size(p_answers) > 16384 then
    raise exception 'Answers are too long';
  end if;

  v_weekday := extract(isodow from p_date)::int - 1;
  select exists (
    select 1 from public.availability_windows w
    where w.profile_id = t.profile_id and w.kind = 'available'
      and w.weekday = v_weekday
      and w.start_min <= p_start and w.end_min >= v_end
      and (w.valid_from is null or w.valid_from <= p_date)
      and (w.valid_to is null or w.valid_to >= p_date)
  ) into v_ok;
  if not v_ok then raise exception 'That time isn''t offered'; end if;

  if t.capacity > 1 then
    select count(*) into v_seats from public.bookings b
     where b.type_id = p_type and b.on_date = p_date and b.start_min = p_start
       and b.status in ('pending', 'confirmed');
    if v_seats >= t.capacity then
      raise exception 'This session is full — pick another time';
    end if;
    if exists (select 1 from public.bookings b
       where b.type_id = p_type and b.on_date = p_date and b.start_min = p_start
         and b.status in ('pending', 'confirmed')
         and b.guest_email = lower(btrim(p_email))) then
      raise exception 'You''re already in this session';
    end if;
  end if;

  if exists (
    select 1 from public.bookings b
    where b.provider_id = t.profile_id and b.on_date = p_date
      and b.status in ('pending', 'confirmed')
      and b.start_min < v_end + t.buffer_min and b.end_min + t.buffer_min > p_start
      and not (t.capacity > 1 and b.type_id = p_type and b.start_min = p_start)
  ) or exists (
    select 1 from public.events e
    where e.owner_profile_id = t.profile_id and e.recurrence is null
      and p_date between e.start_date and e.end_date
      and (e.all_day or (coalesce(e.start_min, 0) < v_end + t.buffer_min
                         and coalesce(e.end_min, 1440) + t.buffer_min > p_start))
      and not (t.capacity > 1 and exists (
        select 1 from public.bookings lb
        where lb.event_id = e.id and lb.type_id = p_type))
  ) or exists (
    select 1 from public.external_busy x
    where x.profile_id = t.profile_id and x.on_date = p_date
      and (x.all_day or (coalesce(x.start_min, 0) < v_end + t.buffer_min
                         and coalesce(x.end_min, 1440) + t.buffer_min > p_start))
  ) then
    raise exception 'That slot was just taken — pick another';
  end if;

  insert into public.bookings (type_id, provider_id, booker_id, on_date, start_min, end_min,
                               status, note, answers, guest_name, guest_email)
  values (p_type, t.profile_id, null, p_date, p_start, v_end,
          case when t.approval = 'instant' then 'confirmed' else 'pending' end,
          coalesce(p_note, ''), p_answers, btrim(p_name), lower(btrim(p_email)))
  returning id, guest_token into v_id, v_token;

  if t.approval = 'instant' then
    perform public._booking_attach_event(v_id);
    perform public.notify(t.profile_id, 'calendar', null, 'booking',
      btrim(p_name) || ' booked ' || t.title || ' (from outside Lichen)',
      to_char(p_date, 'FMMon FMDD') || ' — it''s on your calendar.', '/bookings', null);
  else
    perform public.notify(t.profile_id, 'calendar', null, 'booking',
      btrim(p_name) || ' requested ' || t.title || ' (from outside Lichen)',
      to_char(p_date, 'FMMon FMDD') || ' — accept or decline in Bookings.', '/bookings', null);
  end if;
  return v_token;
end;
$func$;

-- ── respond/cancel ride the shared-event helpers now ────────────────────────

create or replace function public.respond_booking(p_booking uuid, p_accept boolean)
returns void
language plpgsql
security definer
set search_path to 'public'
as $func$
declare b record; t record;
begin
  select * into b from public.bookings where id = p_booking;
  if b is null or b.provider_id <> auth.uid() then raise exception 'Not yours to answer'; end if;
  if b.status <> 'pending' then raise exception 'Already answered'; end if;
  select * into t from public.booking_types where id = b.type_id;
  if p_accept then
    update public.bookings set status = 'confirmed' where id = p_booking;
    perform public._booking_attach_event(p_booking);
    if b.booker_id is not null then
      perform public.notify(b.booker_id, 'calendar', null, 'booking',
        t.title || ' is confirmed',
        to_char(b.on_date, 'FMMon FMDD') || ' — it''s on your calendar.', '/bookings', auth.uid());
    end if;
  else
    update public.bookings set status = 'declined' where id = p_booking;
    if b.booker_id is not null then
      perform public.notify(b.booker_id, 'calendar', null, 'booking',
        t.title || ' — this time didn''t work',
        'Pick another slot whenever you like.', '/bookings', auth.uid());
    end if;
  end if;
end;
$func$;

create or replace function public.cancel_booking(p_booking uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $func$
declare b record; t record; v_other uuid; v_name text;
begin
  select * into b from public.bookings where id = p_booking;
  if b is null or (auth.uid() is distinct from b.provider_id
                   and auth.uid() is distinct from b.booker_id) then
    raise exception 'Not yours to cancel';
  end if;
  if b.status in ('cancelled', 'declined') then return; end if;
  select * into t from public.booking_types where id = b.type_id;
  perform public._booking_detach_event(p_booking);
  update public.bookings set status = 'cancelled' where id = p_booking;
  v_other := case when auth.uid() = b.provider_id then b.booker_id else b.provider_id end;
  if v_other is not null then
    select full_name into v_name from public.profiles where id = auth.uid();
    perform public.notify(v_other, 'calendar', null, 'booking',
      t.title || ' on ' || to_char(b.on_date, 'FMMon FMDD') || ' was cancelled',
      'Cancelled by ' || coalesce(v_name, 'the other member') || '.', '/bookings', auth.uid());
  end if;
end;
$func$;

create or replace function public.guest_cancel_booking(p_token text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $func$
declare b record; t record;
begin
  select * into b from public.bookings where guest_token = p_token and guest_email is not null;
  if b is null then return; end if;
  if b.status in ('cancelled', 'declined') then return; end if;
  select * into t from public.booking_types where id = b.type_id;
  perform public._booking_detach_event(b.id);
  update public.bookings set status = 'cancelled' where id = b.id;
  perform public.notify(b.provider_id, 'calendar', null, 'booking',
    t.title || ' on ' || to_char(b.on_date, 'FMMon FMDD') || ' was cancelled',
    'Cancelled by ' || coalesce(b.guest_name, 'the guest') || ' (outside Lichen).', '/bookings', null);
end;
$func$;

-- ── RESCHEDULE (the audit's #1 gap) ─────────────────────────────────────────
-- Either party moves a live booking to a new open slot; everything a fresh
-- booking checks is re-checked (the notice/window/cap trigger fires on the
-- UPDATE too), the calendar event moves, the other side hears. Status is
-- KEPT (Calendly's shape: a reschedule isn't a new request). Returns the
-- guest token when the PROVIDER moved a guest's booking, so the client can
-- send the state-derived mail.

create or replace function public.reschedule_booking(p_booking uuid, p_date date, p_start integer)
returns text
language plpgsql
security definer
set search_path to 'public'
as $func$
declare b record; t record; v_end integer; v_weekday int; v_ok boolean;
        v_name text; v_other uuid; v_when text; v_seats int;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  select * into b from public.bookings where id = p_booking;
  if b is null or (auth.uid() is distinct from b.provider_id
                   and auth.uid() is distinct from b.booker_id) then
    raise exception 'Not yours to move';
  end if;
  if b.status not in ('pending', 'confirmed') then
    raise exception 'This booking isn''t live any more';
  end if;
  select * into t from public.booking_types where id = b.type_id;
  v_end := p_start + t.duration_min;
  if v_end > 1440 then raise exception 'Slot runs past midnight'; end if;
  if p_date < current_date then raise exception 'That day has passed'; end if;

  v_weekday := extract(isodow from p_date)::int - 1;
  select exists (
    select 1 from public.availability_windows w
    where w.profile_id = b.provider_id and w.kind = 'available'
      and w.weekday = v_weekday
      and w.start_min <= p_start and w.end_min >= v_end
      and (w.valid_from is null or w.valid_from <= p_date)
      and (w.valid_to is null or w.valid_to >= p_date)
  ) into v_ok;
  if not v_ok then raise exception 'That time isn''t offered'; end if;

  if t.capacity > 1 then
    select count(*) into v_seats from public.bookings x
     where x.type_id = b.type_id and x.on_date = p_date and x.start_min = p_start
       and x.status in ('pending', 'confirmed') and x.id <> b.id;
    if v_seats >= t.capacity then
      raise exception 'This session is full at that time';
    end if;
  end if;

  if exists (
    select 1 from public.bookings x
    where x.provider_id = b.provider_id and x.on_date = p_date
      and x.status in ('pending', 'confirmed') and x.id <> b.id
      and x.start_min < v_end + t.buffer_min and x.end_min + t.buffer_min > p_start
      and not (t.capacity > 1 and x.type_id = b.type_id and x.start_min = p_start)
  ) or exists (
    select 1 from public.events e
    where e.owner_profile_id = b.provider_id and e.recurrence is null
      and e.id is distinct from b.event_id
      and p_date between e.start_date and e.end_date
      and (e.all_day or (coalesce(e.start_min, 0) < v_end + t.buffer_min
                         and coalesce(e.end_min, 1440) + t.buffer_min > p_start))
      and not (t.capacity > 1 and exists (
        select 1 from public.bookings lb
        where lb.event_id = e.id and lb.type_id = b.type_id))
  ) or exists (
    select 1 from public.external_busy x
    where x.profile_id = b.provider_id and x.on_date = p_date
      and (x.all_day or (coalesce(x.start_min, 0) < v_end + t.buffer_min
                         and coalesce(x.end_min, 1440) + t.buffer_min > p_start))
  ) then
    raise exception 'That slot was just taken — pick another';
  end if;

  perform public._booking_detach_event(p_booking);
  update public.bookings
     set on_date = p_date, start_min = p_start, end_min = v_end,
         reminded_at = null   -- a moved session earns a fresh reminder
   where id = p_booking;      -- notice/window/cap trigger re-checks here
  if b.status = 'confirmed' then
    perform public._booking_attach_event(p_booking);
  end if;

  select full_name into v_name from public.profiles where id = auth.uid();
  v_when := to_char(p_date, 'FMMon FMDD') || ' · '
         || to_char(p_date::timestamp + make_interval(mins => p_start), 'FMHH12:MIam');
  v_other := case when auth.uid() = b.provider_id then b.booker_id else b.provider_id end;
  if v_other is not null then
    perform public.notify(v_other, 'calendar', null, 'booking',
      t.title || ' moved to ' || v_when,
      'Rescheduled by ' || coalesce(v_name, 'the other member') || '.', '/bookings', auth.uid());
  end if;

  return case when auth.uid() = b.provider_id and b.booker_id is null
              then b.guest_token else null end;
end;
$func$;

create or replace function public.guest_reschedule_booking(p_token text, p_date date, p_start integer)
returns void
language plpgsql
security definer
set search_path to 'public'
as $func$
declare b record; t record; v_end integer; v_weekday int; v_ok boolean;
        v_when text; v_seats int;
begin
  select * into b from public.bookings where guest_token = p_token and guest_email is not null;
  if b is null then raise exception 'This booking link isn''t valid'; end if;
  if b.status not in ('pending', 'confirmed') then
    raise exception 'This booking isn''t live any more';
  end if;
  select * into t from public.booking_types where id = b.type_id;
  v_end := p_start + t.duration_min;
  if v_end > 1440 then raise exception 'Slot runs past midnight'; end if;
  if p_date < current_date then raise exception 'That day has passed'; end if;

  v_weekday := extract(isodow from p_date)::int - 1;
  select exists (
    select 1 from public.availability_windows w
    where w.profile_id = b.provider_id and w.kind = 'available'
      and w.weekday = v_weekday
      and w.start_min <= p_start and w.end_min >= v_end
      and (w.valid_from is null or w.valid_from <= p_date)
      and (w.valid_to is null or w.valid_to >= p_date)
  ) into v_ok;
  if not v_ok then raise exception 'That time isn''t offered'; end if;

  if t.capacity > 1 then
    select count(*) into v_seats from public.bookings x
     where x.type_id = b.type_id and x.on_date = p_date and x.start_min = p_start
       and x.status in ('pending', 'confirmed') and x.id <> b.id;
    if v_seats >= t.capacity then
      raise exception 'This session is full at that time';
    end if;
  end if;

  if exists (
    select 1 from public.bookings x
    where x.provider_id = b.provider_id and x.on_date = p_date
      and x.status in ('pending', 'confirmed') and x.id <> b.id
      and x.start_min < v_end + t.buffer_min and x.end_min + t.buffer_min > p_start
      and not (t.capacity > 1 and x.type_id = b.type_id and x.start_min = p_start)
  ) or exists (
    select 1 from public.events e
    where e.owner_profile_id = b.provider_id and e.recurrence is null
      and e.id is distinct from b.event_id
      and p_date between e.start_date and e.end_date
      and (e.all_day or (coalesce(e.start_min, 0) < v_end + t.buffer_min
                         and coalesce(e.end_min, 1440) + t.buffer_min > p_start))
      and not (t.capacity > 1 and exists (
        select 1 from public.bookings lb
        where lb.event_id = e.id and lb.type_id = b.type_id))
  ) or exists (
    select 1 from public.external_busy x
    where x.profile_id = b.provider_id and x.on_date = p_date
      and (x.all_day or (coalesce(x.start_min, 0) < v_end + t.buffer_min
                         and coalesce(x.end_min, 1440) + t.buffer_min > p_start))
  ) then
    raise exception 'That slot was just taken — pick another';
  end if;

  perform public._booking_detach_event(b.id);
  update public.bookings
     set on_date = p_date, start_min = p_start, end_min = v_end,
         reminded_at = null
   where id = b.id;
  if b.status = 'confirmed' then
    perform public._booking_attach_event(b.id);
  end if;

  v_when := to_char(p_date, 'FMMon FMDD') || ' · '
         || to_char(p_date::timestamp + make_interval(mins => p_start), 'FMHH12:MIam');
  perform public.notify(b.provider_id, 'calendar', null, 'booking',
    t.title || ' moved to ' || v_when,
    'Rescheduled by ' || coalesce(b.guest_name, 'the guest') || ' (outside Lichen).', '/bookings', null);
end;
$func$;

-- ── guest_booking: the token view gains type_id (for the reschedule picker)
--    and capacity (so the page can say "group session"). Return type changes
--    need a DROP first. ─────────────────────────────────────────────────────

drop function if exists public.guest_booking(text);

create function public.guest_booking(p_token text)
returns table(guest_name text, status text, on_date date, start_min integer, end_min integer,
              note text, type_title text, type_location text, duration_min integer,
              provider_name text, type_id uuid, capacity integer)
language sql
stable security definer
set search_path to 'public'
as $func$
  select b.guest_name, b.status, b.on_date, b.start_min, b.end_min, b.note,
         t.title, t.location, t.duration_min,
         coalesce(p.full_name, 'A Lichen member'),
         t.id, t.capacity
  from public.bookings b
  join public.booking_types t on t.id = b.type_id
  join public.profiles p on p.id = b.provider_id
  where b.guest_token = p_token and b.guest_email is not null;
$func$;

-- ── The boards carry everything the pickers now need ────────────────────────

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
      'min_notice_min', t.min_notice_min, 'max_days_out', t.max_days_out,
      'max_per_day', t.max_per_day, 'capacity', t.capacity,
      'questions', coalesce(t.questions, '[]'::jsonb),
      'provider_tz', (select timezone from public.profiles where id = t.profile_id)),
    'windows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'weekday', w.weekday, 'start_min', w.start_min, 'end_min', w.end_min,
        'valid_from', w.valid_from, 'valid_to', w.valid_to))
      from public.availability_windows w
      where w.profile_id = t.profile_id and w.kind = 'available'), '[]'::jsonb),
    'day_counts', coalesce((
      select jsonb_object_agg(dc.on_date::text, dc.n) from (
        select bk.on_date, count(distinct bk.start_min) n
        from public.bookings bk
        where bk.type_id = t.id and bk.status in ('pending', 'confirmed')
          and bk.on_date between p_from and p_to
        group by bk.on_date) dc), '{}'::jsonb),
    'seat_counts', coalesce((
      select jsonb_agg(jsonb_build_object('on_date', sc.on_date, 'start_min', sc.start_min, 'n', sc.n)) from (
        select bk.on_date, bk.start_min, count(*) n
        from public.bookings bk
        where bk.type_id = t.id and bk.status in ('pending', 'confirmed')
          and bk.on_date between p_from and p_to
        group by 1, 2) sc), '[]'::jsonb),
    'busy', coalesce((
      select jsonb_agg(b) from (
        select e.start_date, e.end_date, e.all_day, e.start_min, e.end_min, e.recurrence
        from public.events e
        where (e.owner_profile_id = t.profile_id
               or exists (select 1 from public.event_attendees a
                          where a.event_id = e.id and a.profile_id = t.profile_id
                            and a.status <> 'declined'))
          and e.start_date <= p_to and (e.end_date >= p_from or e.recurrence is not null)
          and not (t.capacity > 1 and exists (
            select 1 from public.bookings lb
            where lb.event_id = e.id and lb.type_id = t.id))
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
          and not (t.capacity > 1 and bk.type_id = t.id)
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
      'min_notice_min', t.min_notice_min, 'max_days_out', t.max_days_out,
      'max_per_day', t.max_per_day, 'capacity', t.capacity,
      'questions', coalesce(t.questions, '[]'::jsonb),
      'provider_tz', (select timezone from public.profiles where id = t.profile_id)),
    'windows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'weekday', w.weekday, 'start_min', w.start_min, 'end_min', w.end_min,
        'valid_from', w.valid_from, 'valid_to', w.valid_to))
      from public.availability_windows w
      where w.profile_id = t.profile_id and w.kind = 'available'), '[]'::jsonb),
    'day_counts', coalesce((
      select jsonb_object_agg(dc.on_date::text, dc.n) from (
        select bk.on_date, count(distinct bk.start_min) n
        from public.bookings bk
        where bk.type_id = t.id and bk.status in ('pending', 'confirmed')
          and bk.on_date between p_from and p_to
        group by bk.on_date) dc), '{}'::jsonb),
    'seat_counts', coalesce((
      select jsonb_agg(jsonb_build_object('on_date', sc.on_date, 'start_min', sc.start_min, 'n', sc.n)) from (
        select bk.on_date, bk.start_min, count(*) n
        from public.bookings bk
        where bk.type_id = t.id and bk.status in ('pending', 'confirmed')
          and bk.on_date between p_from and p_to
        group by 1, 2) sc), '[]'::jsonb),
    'busy', coalesce((
      select jsonb_agg(x) from (
        select e.start_date, e.end_date, e.all_day, e.start_min, e.end_min, e.recurrence
        from public.events e
        where (e.owner_profile_id = t.profile_id
               or exists (select 1 from public.event_attendees a
                          where a.event_id = e.id and a.profile_id = t.profile_id and a.status <> 'declined'))
          and e.start_date <= p_to and (e.end_date >= p_from or e.recurrence is not null)
          and not (t.capacity > 1 and exists (
            select 1 from public.bookings lb
            where lb.event_id = e.id and lb.type_id = t.id))
        union all
        select b.on_date, b.on_date, false, b.start_min, b.end_min, null::jsonb
        from public.bookings b
        where b.provider_id = t.profile_id and b.status in ('pending', 'confirmed')
          and b.on_date between p_from and p_to
          and not (t.capacity > 1 and b.type_id = t.id)
        union all
        select xb.on_date, xb.on_date, xb.all_day, xb.start_min, xb.end_min, null::jsonb
        from public.external_busy xb
        where xb.profile_id = t.profile_id and xb.on_date between p_from and p_to
      ) x), '[]'::jsonb))
  from public.booking_types t
  where t.id = p_type and t.active and t.audience = 'public';
$func$;

-- ── REMINDERS (the audit's #2 gap) ──────────────────────────────────────────
-- Every 10 minutes: confirmed sessions inside their last 24 hours that
-- haven't been reminded get one. Members hear by bell (which rides push);
-- guests hear by email (send-booking-mail kind='reminder', via pg_net —
-- the push_on_notification pattern). A booking made less than an hour ago
-- is skipped: its confirmation just said everything a reminder would.

create or replace function public.tick_booking_reminders()
returns void
language plpgsql
security definer
set search_path to 'public'
as $func$
declare r record; v_now timestamp; v_slot timestamp; v_secret text; v_when text;
begin
  for r in
    select b.id, b.on_date, b.start_min, b.provider_id, b.booker_id,
           b.guest_token, b.created_at, t.title,
           coalesce(nullif(p.timezone, ''), 'UTC') as tz
    from public.bookings b
    join public.booking_types t on t.id = b.type_id
    join public.profiles p on p.id = b.provider_id
    where b.status = 'confirmed' and b.reminded_at is null
      and b.on_date between current_date - 1 and current_date + 2
  loop
    begin
      begin
        v_now := now() at time zone r.tz;
      exception when others then
        v_now := now() at time zone 'UTC';
      end;
      v_slot := r.on_date::timestamp + make_interval(mins => r.start_min);
      if v_slot > v_now and v_slot <= v_now + interval '24 hours'
         and r.created_at < now() - interval '1 hour' then
        update public.bookings set reminded_at = now() where id = r.id;
        v_when := to_char(v_slot, 'FMDay') || ' at ' || to_char(v_slot, 'FMHH12:MIam');
        perform public.notify(r.provider_id, 'calendar', null, 'booking',
          'Coming up: ' || r.title, v_when || '.', '/bookings', null);
        if r.booker_id is not null then
          perform public.notify(r.booker_id, 'calendar', null, 'booking',
            'Coming up: ' || r.title, v_when || '.', '/bookings', null);
        elsif r.guest_token is not null then
          begin
            select decrypted_secret into v_secret
              from vault.decrypted_secrets where name = 'push_hook_secret';
            perform net.http_post(
              url := 'https://mjqnaevertyzgjlpwynr.supabase.co/functions/v1/send-booking-mail',
              headers := jsonb_build_object('Content-Type', 'application/json',
                                            'x-webhook-secret', coalesce(v_secret, '')),
              body := jsonb_build_object('token', r.guest_token, 'kind', 'reminder'));
          exception when others then
            null;  -- a mail hiccup must never block the sweep
          end;
        end if;
      end if;
    exception when others then
      null;  -- one bad row never stalls the rest
    end;
  end loop;
end;
$func$;

select cron.schedule('tick-booking-reminders', '*/10 * * * *',
                     'select public.tick_booking_reminders()');
