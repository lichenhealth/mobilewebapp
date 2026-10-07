-- VIDEO LINKS ON BOOKING TYPES (founder 2026-10-06: "Let's get zoom hooked
-- up to Lichen's schedule feature, and let's do an easy link to other
-- software people might use, like google meet, etc" — moving her scheduling
-- off Calendly).
--
-- 1. booking_type_meetings — ONE video link per booking type (Zoom, Meet,
--    Teams, Webex, Whereby, Jitsi, FaceTime, any https link). Its own
--    OWNER-ONLY table, deliberately NOT a booking_types column: a type row is
--    readable by anyone it's visible to (and public types by the open web via
--    the board RPCs), and a personal meeting room posted publicly is a door
--    strangers can walk through at any hour — a real confidentiality problem
--    for a therapist. The link reaches people only by BOOKING.
-- 2. bookings.meeting_url — stamped by _booking_attach_event, which runs
--    exactly when a booking becomes CONFIRMED (instant create, accept,
--    reschedule of a confirmed booking). bookings is parties-only read, so the
--    provider and the member booker see it; a guest sees it through
--    guest_booking(token), only while confirmed. A pending request never
--    carries it. Per-BOOKING storage is also where a future per-booking Zoom
--    meeting (Zoom OAuth — not built) would land, with no schema change.
-- 3. The linked calendar event's LOCATION becomes the link (SmartLocation
--    already renders a video URL as "Join Zoom/Meet…"), and a physical
--    location, if the type also has one, moves into the description.
-- 4. Changing or removing a type's link re-stamps that type's UPCOMING
--    confirmed bookings (and their events) — nobody shows up to a dead room.

-- ── Schema ──────────────────────────────────────────────────────────────────

create table if not exists public.booking_type_meetings (
  type_id uuid primary key references public.booking_types(id) on delete cascade,
  url text not null,
  updated_at timestamptz not null default now(),
  constraint booking_type_meetings_url_shape
    check (url ~* '^https://[^[:space:]]+$' and length(url) <= 500)
);

alter table public.booking_type_meetings enable row level security;
drop policy if exists "meetings: type owner all" on public.booking_type_meetings;
create policy "meetings: type owner all" on public.booking_type_meetings
  for all using (exists (select 1 from public.booking_types t
                         where t.id = type_id and t.profile_id = auth.uid()))
  with check (exists (select 1 from public.booking_types t
                      where t.id = type_id and t.profile_id = auth.uid()));
grant select, insert, update, delete on public.booking_type_meetings to authenticated;

alter table public.bookings
  add column if not exists meeting_url text;

-- ── _booking_attach_event: stamp the link + put it on the event ─────────────
-- Same body as 20261003220000 plus the link (v_link). Keep the two in step if
-- either changes.

create or replace function public._booking_attach_event(p_booking uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $func$
declare b record; t record; v_event uuid; v_name text; v_link text;
begin
  select * into b from public.bookings where id = p_booking;
  if b is null then return null; end if;
  select * into t from public.booking_types where id = b.type_id;
  select m.url into v_link from public.booking_type_meetings m where m.type_id = b.type_id;
  -- An already-stamped link wins (a future per-booking meeting would live here).
  v_link := coalesce(nullif(b.meeting_url, ''), v_link);

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
            concat_ws(E'\n\n',
              nullif(case when t.capacity > 1 then '' else coalesce(b.note, '') end, ''),
              -- the link takes the location slot; a real place rides along here
              case when v_link is not null and coalesce(t.location, '') <> ''
                   then 'Location: ' || t.location end),
            coalesce(v_link, t.location), b.on_date, b.on_date, false, b.start_min, b.end_min)
    returning id into v_event;
  end if;

  if b.booker_id is not null then
    insert into public.event_attendees (event_id, profile_id, status, invited_by)
    values (v_event, b.booker_id, 'going', b.provider_id)
    on conflict do nothing;
  end if;

  update public.bookings
     set event_id = v_event,
         meeting_url = case when b.status = 'confirmed' then v_link else meeting_url end
   where id = p_booking;
  return v_event;
end;
$func$;
revoke all on function public._booking_attach_event(uuid) from public, anon, authenticated;

-- ── guest_booking: the link, only while confirmed ───────────────────────────
-- Return type changes need a DROP first.

drop function if exists public.guest_booking(text);

create function public.guest_booking(p_token text)
returns table(guest_name text, status text, on_date date, start_min integer, end_min integer,
              note text, type_title text, type_location text, duration_min integer,
              provider_name text, type_id uuid, capacity integer, meeting_url text)
language sql
stable security definer
set search_path to 'public'
as $func$
  select b.guest_name, b.status, b.on_date, b.start_min, b.end_min, b.note,
         t.title, t.location, t.duration_min,
         coalesce(p.full_name, 'A Lichen member'),
         t.id, t.capacity,
         case when b.status = 'confirmed' then b.meeting_url end
  from public.bookings b
  join public.booking_types t on t.id = b.type_id
  join public.profiles p on p.id = b.provider_id
  where b.guest_token = p_token and b.guest_email is not null;
$func$;
grant execute on function public.guest_booking(text) to anon, authenticated;

-- ── A changed link follows the upcoming sessions ────────────────────────────

create or replace function public.sync_booking_meeting_link()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $func$
declare v_type uuid; v_new text; v_old text;
begin
  if tg_op = 'DELETE' then
    v_type := old.type_id; v_new := null; v_old := old.url;
  else
    v_type := new.type_id; v_new := new.url;
    v_old := case when tg_op = 'UPDATE' then old.url end;
    if v_new is not distinct from v_old then return new; end if;
  end if;

  -- Events first (they're found through the bookings' current link): only
  -- an event whose location IS the old link (or empty) is ours to rewrite.
  update public.events e
     set location = coalesce(v_new, (select t.location from public.booking_types t where t.id = v_type), '')
   where e.id in (select bk.event_id from public.bookings bk
                   where bk.type_id = v_type and bk.status = 'confirmed'
                     and bk.on_date >= current_date and bk.event_id is not null)
     and (e.location = coalesce(v_old, '') or e.location = '');

  update public.bookings
     set meeting_url = v_new
   where type_id = v_type and status = 'confirmed' and on_date >= current_date
     and (meeting_url is null or meeting_url is not distinct from v_old);

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$func$;
revoke all on function public.sync_booking_meeting_link() from public, anon, authenticated;

drop trigger if exists booking_meeting_link_sync on public.booking_type_meetings;
create trigger booking_meeting_link_sync
  after insert or update or delete on public.booking_type_meetings
  for each row execute function public.sync_booking_meeting_link();
