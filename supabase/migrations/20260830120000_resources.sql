-- ROOMS & THINGS (founder 2026-07-27): spaces — and people — steward
-- bookable RESOURCES: the pavilion, the formal dinner plates, your truck.
-- A resource has a calendar exactly the way a person does (events grow a
-- third owner), lend/rent/borrow gain real dates, and search will one day
-- ask one availability question of people, places, rooms, and things alike.
-- PRIVACY (founder-set): anyone who can see the resource sees WHEN it's
-- busy, never WHO booked it — identity is only revealed inside a DM the
-- asker deliberately opens ("message who booked it").

-- ── 1. Resources ─────────────────────────────────────────────────────────────
create table if not exists public.resources (
  id uuid primary key default gen_random_uuid(),
  space_id uuid references public.spaces(id) on delete cascade,
  owner_profile_id uuid references public.profiles(id) on delete cascade,
  constraint resources_one_owner check
    (((space_id is not null)::integer + (owner_profile_id is not null)::integer) = 1),
  name text not null,
  kind text not null check (kind in ('room', 'thing')),
  description text,
  photo_url text,
  bookable boolean not null default true,
  approval text not null default 'request' check (approval in ('request', 'instant')),
  created_at timestamptz not null default now()
);
create index if not exists resources_space_idx on public.resources (space_id);
create index if not exists resources_owner_idx on public.resources (owner_profile_id);
alter table public.resources enable row level security;

create or replace function public.is_resource_steward(p_resource uuid, p_uid uuid)
returns boolean language sql stable security definer set search_path = public as $fn$
  select exists (
    select 1 from public.resources r
    where r.id = p_resource
      and (r.owner_profile_id = p_uid
        or (r.space_id is not null and public.is_space_admin(r.space_id, p_uid)))
  );
$fn$;

create policy "resources: read" on public.resources
  for select to authenticated using (true);
create policy "resources: steward writes" on public.resources
  for all to authenticated
  using (owner_profile_id = auth.uid()
    or (space_id is not null and public.is_space_admin(space_id, auth.uid())))
  with check (owner_profile_id = auth.uid()
    or (space_id is not null and public.is_space_admin(space_id, auth.uid())));

-- ── 2. Events grow a third owner (the widening planned in part 5) ────────────
alter table public.events add column if not exists
  owner_resource_id uuid references public.resources(id) on delete cascade;
alter table public.events drop constraint if exists events_one_owner;
alter table public.events add constraint events_one_owner check
  ((((owner_profile_id is not null)::integer
    + (owner_space_id is not null)::integer
    + (owner_resource_id is not null)::integer) = 1));
create index if not exists events_owner_resource_idx
  on public.events (owner_resource_id, start_date) where (owner_resource_id is not null);
-- can_read_event stays UNCHANGED: outsiders can't read a resource's event
-- rows (that would leak the booker via attendees) — busy comes from the
-- span-only function below; the booker reads via the attendee arm.

-- ── 3. Bookings on a resource ────────────────────────────────────────────────
create table if not exists public.resource_bookings (
  id uuid primary key default gen_random_uuid(),
  resource_id uuid not null references public.resources(id) on delete cascade,
  requester_id uuid not null references public.profiles(id) on delete cascade,
  start_date date not null,
  end_date date not null,
  start_min int, end_min int,        -- null = all-day span
  note text,
  status text not null default 'pending'
    check (status in ('pending', 'confirmed', 'declined', 'canceled')),
  event_id uuid references public.events(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists resource_bookings_resource_idx
  on public.resource_bookings (resource_id, status);
alter table public.resource_bookings enable row level security;
create policy "rb: parties read" on public.resource_bookings
  for select to authenticated using (
    requester_id = auth.uid() or public.is_resource_steward(resource_id, auth.uid())
  );
-- No client writes — the RPCs below are the only doors.

-- Busy spans, identity-free (anyone who can see the resource may ask).
create or replace function public.resource_busy(p_resource uuid)
returns table (start_date date, end_date date, start_min int, end_min int)
language sql stable security definer set search_path = public as $fn$
  select e.start_date, e.end_date, e.start_min, e.end_min
  from public.events e
  where e.owner_resource_id = p_resource
    and e.end_date >= current_date - 1
  order by e.start_date;
$fn$;
grant execute on function public.resource_busy(uuid) to authenticated;

-- The "message who booked it" door: a DELIBERATE identity reveal —
-- returns the booker of a confirmed span so the asker can open a DM and
-- negotiate ("any chance you'd be open to another time?").
create or replace function public.resource_span_contact(p_resource uuid, p_date date)
returns uuid language sql stable security definer set search_path = public as $fn$
  select b.requester_id from public.resource_bookings b
  where b.resource_id = p_resource and b.status = 'confirmed'
    and b.start_date <= p_date and b.end_date >= p_date
  order by b.created_at limit 1;
$fn$;
grant execute on function public.resource_span_contact(uuid, date) to authenticated;

create or replace function public.request_resource_booking(
  p_resource uuid, p_start date, p_end date,
  p_start_min int default null, p_end_min int default null, p_note text default null
) returns uuid
language plpgsql security definer set search_path = public as $fn$
declare
  v_res public.resources%rowtype;
  v_id uuid; v_event uuid; v_who text; v_steward uuid;
begin
  select * into v_res from public.resources where id = p_resource;
  if v_res.id is null or not v_res.bookable then
    raise exception 'This isn''t bookable';
  end if;
  if p_end < p_start then raise exception 'Backwards dates'; end if;
  -- Overlap check: confirmed bookings and any calendar block on the resource.
  if exists (
    select 1 from public.resource_bookings b
    where b.resource_id = p_resource and b.status = 'confirmed'
      and b.start_date <= p_end and b.end_date >= p_start
  ) or exists (
    select 1 from public.events e
    where e.owner_resource_id = p_resource
      and e.start_date <= p_end and e.end_date >= p_start
  ) then
    raise exception 'Those dates are already taken';
  end if;

  insert into public.resource_bookings
    (resource_id, requester_id, start_date, end_date, start_min, end_min, note)
  values (p_resource, auth.uid(), p_start, p_end, p_start_min, p_end_min, p_note)
  returning id into v_id;

  if v_res.approval = 'instant' then
    perform public.confirm_resource_booking_inner(v_id, auth.uid());
  else
    select full_name into v_who from public.profiles where id = auth.uid();
    for v_steward in
      select distinct s.profile_id from (
        select r.owner_profile_id as profile_id from public.resources r
          where r.id = p_resource and r.owner_profile_id is not null
        union
        select m.profile_id from public.resources r
          join public.space_members m on m.space_id = r.space_id
          where r.id = p_resource and m.role in ('admin', 'super_admin')
      ) s
    loop
      perform public.notify(
        v_steward, 'calendar', (select space_id from public.resources where id = p_resource),
        'resource_booking_request',
        coalesce(v_who, 'A member') || ' asked to book ' || v_res.name,
        p_start::text || case when p_end > p_start then ' – ' || p_end::text else '' end
          || coalesce(' · ' || p_note, ''),
        case when v_res.space_id is not null
          then '/spaces/' || v_res.space_id || '?manage=1' else '/bookings' end,
        auth.uid());
    end loop;
  end if;
  return v_id;
end; $fn$;
revoke all on function public.request_resource_booking(uuid, date, date, int, int, text) from public, anon;
grant execute on function public.request_resource_booking(uuid, date, date, int, int, text) to authenticated;

-- Shared confirm body (instant bookings + steward approvals both land here).
create or replace function public.confirm_resource_booking_inner(p_booking uuid, p_actor uuid)
returns void language plpgsql security definer set search_path = public as $fn$
declare v_b public.resource_bookings%rowtype; v_res public.resources%rowtype; v_event uuid;
begin
  select * into v_b from public.resource_bookings where id = p_booking;
  select * into v_res from public.resources where id = v_b.resource_id;
  insert into public.events
    (creator_id, owner_resource_id, title, start_date, end_date, start_min, end_min, all_day)
  values
    (p_actor, v_b.resource_id, 'Booked', v_b.start_date, v_b.end_date,
     v_b.start_min, v_b.end_min, v_b.start_min is null)
  returning id into v_event;
  insert into public.event_attendees (event_id, profile_id, status)
  values (v_event, v_b.requester_id, 'going')
  on conflict do nothing;
  update public.resource_bookings
  set status = 'confirmed', event_id = v_event where id = p_booking;
  perform public.notify(
    v_b.requester_id, 'calendar', v_res.space_id, 'resource_booking_confirmed',
    v_res.name || ' is yours',
    v_b.start_date::text || case when v_b.end_date > v_b.start_date
      then ' – ' || v_b.end_date::text else '' end,
    '/calendar', p_actor);
end; $fn$;
revoke all on function public.confirm_resource_booking_inner(uuid, uuid) from public, anon, authenticated;

create or replace function public.decide_resource_booking(p_booking uuid, p_approve boolean)
returns void language plpgsql security definer set search_path = public as $fn$
declare v_b public.resource_bookings%rowtype; v_res public.resources%rowtype;
begin
  select * into v_b from public.resource_bookings where id = p_booking;
  if v_b.id is null or v_b.status <> 'pending' then raise exception 'No pending booking'; end if;
  if not public.is_resource_steward(v_b.resource_id, auth.uid()) then
    raise exception 'Only this resource''s steward decides';
  end if;
  if p_approve then
    perform public.confirm_resource_booking_inner(p_booking, auth.uid());
  else
    select * into v_res from public.resources where id = v_b.resource_id;
    update public.resource_bookings set status = 'declined' where id = p_booking;
    perform public.notify(
      v_b.requester_id, 'calendar', v_res.space_id, 'resource_booking_declined',
      v_res.name || ' isn''t available then',
      'Try other dates — or message whoever holds them.', null, auth.uid());
  end if;
end; $fn$;
revoke all on function public.decide_resource_booking(uuid, boolean) from public, anon;
grant execute on function public.decide_resource_booking(uuid, boolean) to authenticated;

create or replace function public.cancel_resource_booking(p_booking uuid)
returns void language plpgsql security definer set search_path = public as $fn$
declare v_b public.resource_bookings%rowtype;
begin
  select * into v_b from public.resource_bookings where id = p_booking;
  if v_b.id is null then return; end if;
  if v_b.requester_id <> auth.uid()
    and not public.is_resource_steward(v_b.resource_id, auth.uid()) then
    raise exception 'Not yours to cancel';
  end if;
  if v_b.event_id is not null then delete from public.events where id = v_b.event_id; end if;
  update public.resource_bookings set status = 'canceled' where id = p_booking;
end; $fn$;
revoke all on function public.cancel_resource_booking(uuid) from public, anon;
grant execute on function public.cancel_resource_booking(uuid) to authenticated;
