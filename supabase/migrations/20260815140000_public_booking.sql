-- THE PUBLIC BOOKING LINK (founder 2026-08-14): "I want people to be able to
-- use their booking link generated as a calendly replacement, and to have it
-- be tied to their lichen cal, but also any other, imported calendars, so
-- its a true, real time snapshot of their availability."
--
-- The availability truth already exists (booking_board = declared hours
-- minus ALL busy). This adds the third audience ('public' — anyone with the
-- link, on Lichen or not), a guest identity on bookings (event_guests'
-- unguessable-token pattern), and the anon doors: read the page, read the
-- board, request/cancel a slot. Guest mails ride the send-booking-mail edge
-- function; in-app bells keep flowing to the provider via notify().

-- ── The third audience ──────────────────────────────────────────────────────
alter table public.booking_types
  drop constraint if exists booking_types_audience_check,
  add constraint booking_types_audience_check
    check (audience = any (array['everyone'::text, 'mycelium'::text, 'public'::text]));

-- 'public' reads like 'everyone' for signed-in members.
create or replace function public.booking_type_visible(p_type uuid, p_viewer uuid)
returns boolean language sql stable security definer set search_path to 'public' as $func$
  select exists (select 1 from public.booking_types t
    where t.id = p_type and t.active and (
      t.profile_id = p_viewer
      or t.audience in ('everyone', 'public')
      or (t.audience = 'mycelium' and exists (
        select 1 from public.mycelium m
        where m.truster_id = t.profile_id and m.target_type = 'profile' and m.target_id = p_viewer))));
$func$;

-- ── Guests on bookings ──────────────────────────────────────────────────────
alter table public.bookings alter column booker_id drop not null;
alter table public.bookings
  add column guest_name text,
  add column guest_email text,
  add column guest_token text unique default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
alter table public.bookings
  add constraint bookings_some_booker_check
    check (booker_id is not null or (guest_name is not null and guest_email is not null));

comment on column public.bookings.guest_token is
  'The unguessable token IS the guest''s authorization (event_guests pattern): /b/<token> shows and manages their booking.';

-- ── Anon doors ──────────────────────────────────────────────────────────────
-- The page behind lichen.health/book/<handle>: who this is + their public
-- session types. Nothing renders for members without public types.
create or replace function public.public_booking_page(p_handle text)
returns jsonb language sql stable security definer set search_path to 'public' as $func$
  select jsonb_build_object(
    'provider', jsonb_build_object(
      'id', p.id, 'full_name', p.full_name, 'avatar_url', p.avatar_url,
      'headline', p.headline, 'timezone', p.timezone),
    'types', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id, 'title', t.title, 'description', t.description,
        'duration_min', t.duration_min, 'buffer_min', t.buffer_min,
        'price', t.price, 'location', t.location, 'approval', t.approval)
        order by t.created_at)
      from public.booking_types t
      where t.profile_id = p.id and t.active and t.audience = 'public'), '[]'::jsonb))
  from public.profiles p
  where lower(p.handle) = lower(p_handle)
    and exists (select 1 from public.booking_types t
                where t.profile_id = p.id and t.active and t.audience = 'public');
$func$;
grant execute on function public.public_booking_page(text) to anon, authenticated;

-- The board, anon: booking_board's exact payload shape, PUBLIC types only.
-- Busy spans are titleless — free/busy is all a stranger learns.
create or replace function public.public_booking_board(p_type uuid, p_from date, p_to date)
returns jsonb language sql stable security definer set search_path to 'public' as $func$
  select jsonb_build_object(
    'type', jsonb_build_object(
      'id', t.id, 'provider_id', t.profile_id, 'title', t.title,
      'description', t.description, 'duration_min', t.duration_min,
      'buffer_min', t.buffer_min, 'price', t.price, 'location', t.location,
      'approval', t.approval),
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
grant execute on function public.public_booking_board(uuid, date, date) to anon, authenticated;

-- A guest requests (or instantly books) a slot. Mirrors create_booking's
-- validation exactly; the guest has no uid, so identity is name + email and
-- the returned token is their key.
create or replace function public.guest_create_booking(
  p_type uuid, p_date date, p_start integer,
  p_name text, p_email text, p_note text default ''
) returns text language plpgsql security definer set search_path to 'public' as $func$
declare t record; v_end integer; v_id uuid; v_event uuid; v_token text;
        v_weekday int; v_ok boolean;
begin
  select * into t from public.booking_types where id = p_type and active and audience = 'public';
  if t is null then raise exception 'This session isn''t open to the public'; end if;
  if btrim(coalesce(p_name, '')) = '' or p_email !~ '^\S+@\S+\.\S+$' then
    raise exception 'A name and a real email are how the confirmation reaches you';
  end if;
  v_end := p_start + t.duration_min;
  if v_end > 1440 then raise exception 'Slot runs past midnight'; end if;
  if p_date < current_date then raise exception 'That day has passed'; end if;

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

  if exists (
    select 1 from public.bookings b
    where b.provider_id = t.profile_id and b.on_date = p_date
      and b.status in ('pending', 'confirmed')
      and b.start_min < v_end + t.buffer_min and b.end_min + t.buffer_min > p_start
  ) or exists (
    select 1 from public.events e
    where e.owner_profile_id = t.profile_id and e.recurrence is null
      and p_date between e.start_date and e.end_date
      and (e.all_day or (coalesce(e.start_min, 0) < v_end + t.buffer_min
                         and coalesce(e.end_min, 1440) + t.buffer_min > p_start))
  ) or exists (
    select 1 from public.external_busy x
    where x.profile_id = t.profile_id and x.on_date = p_date
      and (x.all_day or (coalesce(x.start_min, 0) < v_end + t.buffer_min
                         and coalesce(x.end_min, 1440) + t.buffer_min > p_start))
  ) then
    raise exception 'That slot was just taken — pick another';
  end if;

  insert into public.bookings (type_id, provider_id, booker_id, on_date, start_min, end_min,
                               status, note, guest_name, guest_email)
  values (p_type, t.profile_id, null, p_date, p_start, v_end,
          case when t.approval = 'instant' then 'confirmed' else 'pending' end,
          coalesce(p_note, ''), btrim(p_name), lower(btrim(p_email)))
  returning id, guest_token into v_id, v_token;

  if t.approval = 'instant' then
    insert into public.events (creator_id, owner_profile_id, title, description, location,
                               start_date, end_date, all_day, start_min, end_min)
    values (t.profile_id, t.profile_id, t.title || ' — ' || btrim(p_name),
            coalesce(p_note, ''), t.location, p_date, p_date, false, p_start, v_end)
    returning id into v_event;
    update public.bookings set event_id = v_event where id = v_id;
    perform public.notify(t.profile_id, 'calendar', null, 'booking',
      btrim(p_name) || ' booked ' || t.title || ' (from outside Lichen)',
      to_char(p_date, 'FMMon FMDD') || ' — it''s on your calendar.', '/bookings', null);
  else
    perform public.notify(t.profile_id, 'calendar', null, 'booking',
      btrim(p_name) || ' requested ' || t.title || ' (from outside Lichen)',
      to_char(p_date, 'FMMon FMDD') || ' — accept or decline in Bookings.', '/bookings', null);
  end if;
  return v_token;
end; $func$;
grant execute on function public.guest_create_booking(uuid, date, integer, text, text, text) to anon, authenticated;

-- The guest's landing page: the token is the whole authorization.
create or replace function public.guest_booking(p_token text)
returns table (
  guest_name text, status text, on_date date, start_min integer, end_min integer,
  note text, type_title text, type_location text, duration_min integer,
  provider_name text
) language sql stable security definer set search_path to 'public' as $func$
  select b.guest_name, b.status, b.on_date, b.start_min, b.end_min, b.note,
         t.title, t.location, t.duration_min,
         coalesce(p.full_name, 'A Lichen member')
  from public.bookings b
  join public.booking_types t on t.id = b.type_id
  join public.profiles p on p.id = b.provider_id
  where b.guest_token = p_token and b.guest_email is not null;
$func$;
grant execute on function public.guest_booking(text) to anon, authenticated;

create or replace function public.guest_cancel_booking(p_token text)
returns void language plpgsql security definer set search_path to 'public' as $func$
declare b record; t record;
begin
  select * into b from public.bookings where guest_token = p_token and guest_email is not null;
  if b is null then return; end if;
  if b.status in ('cancelled', 'declined') then return; end if;
  select * into t from public.booking_types where id = b.type_id;
  if b.event_id is not null then delete from public.events where id = b.event_id; end if;
  update public.bookings set status = 'cancelled', event_id = null where id = b.id;
  perform public.notify(b.provider_id, 'calendar', null, 'booking',
    t.title || ' on ' || to_char(b.on_date, 'FMMon FMDD') || ' was cancelled',
    'Cancelled by ' || coalesce(b.guest_name, 'the guest') || ' (outside Lichen).', '/bookings', null);
end; $func$;
grant execute on function public.guest_cancel_booking(text) to anon, authenticated;

-- ── Null-safe member RPCs ───────────────────────────────────────────────────
-- respond_booking: a guest row has no attendee to seat and no member to bell
-- (send-booking-mail carries the news instead).
create or replace function public.respond_booking(p_booking uuid, p_accept boolean)
returns void language plpgsql security definer set search_path to 'public' as $func$
declare b record; t record; v_event uuid; v_booker_name text;
begin
  select * into b from public.bookings where id = p_booking;
  if b is null or b.provider_id <> auth.uid() then raise exception 'Not yours to answer'; end if;
  if b.status <> 'pending' then raise exception 'Already answered'; end if;
  select * into t from public.booking_types where id = b.type_id;
  if p_accept then
    select coalesce(
      (select full_name from public.profiles where id = b.booker_id),
      b.guest_name) into v_booker_name;
    insert into public.events (creator_id, owner_profile_id, title, description, location,
                               start_date, end_date, all_day, start_min, end_min)
    values (b.provider_id, b.provider_id, t.title || ' — ' || coalesce(v_booker_name, 'a member'),
            b.note, t.location, b.on_date, b.on_date, false, b.start_min, b.end_min)
    returning id into v_event;
    if b.booker_id is not null then
      insert into public.event_attendees (event_id, profile_id, status, invited_by)
      values (v_event, b.booker_id, 'going', b.provider_id);
    end if;
    update public.bookings set status = 'confirmed', event_id = v_event where id = p_booking;
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
end; $func$;

-- cancel_booking: the old guard used `auth.uid() not in (provider, booker)`,
-- which goes NULL (= passes!) when booker_id is null — with guests that was
-- an open door. IS DISTINCT FROM tells the truth about nulls.
create or replace function public.cancel_booking(p_booking uuid)
returns void language plpgsql security definer set search_path to 'public' as $func$
declare b record; t record; v_other uuid; v_name text;
begin
  select * into b from public.bookings where id = p_booking;
  if b is null or (auth.uid() is distinct from b.provider_id
                   and auth.uid() is distinct from b.booker_id) then
    raise exception 'Not yours to cancel';
  end if;
  if b.status in ('cancelled', 'declined') then return; end if;
  select * into t from public.booking_types where id = b.type_id;
  if b.event_id is not null then delete from public.events where id = b.event_id; end if;
  update public.bookings set status = 'cancelled', event_id = null where id = p_booking;
  v_other := case when auth.uid() = b.provider_id then b.booker_id else b.provider_id end;
  if v_other is not null then
    select full_name into v_name from public.profiles where id = auth.uid();
    perform public.notify(v_other, 'calendar', null, 'booking',
      t.title || ' on ' || to_char(b.on_date, 'FMMon FMDD') || ' was cancelled',
      'Cancelled by ' || coalesce(v_name, 'the other member') || '.', '/bookings', auth.uid());
  end if;
end; $func$;
