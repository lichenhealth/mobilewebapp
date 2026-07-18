-- ============================================================================
-- BOOKINGS — the Calendly-like layer (founder go-ahead 2026-07-17).
-- Design (agreed): practitioners define SESSION TYPES; audience gating reuses
-- Lichen grammar (everyone / my mycelium); approval per type (request-and-
-- approve by default, instant allowed); NO payment processing v1 — price is
-- words ("$90", "Sliding $40–90", "Free") and money moves as it already does.
-- A confirmed booking becomes a real events row (provider-owned, booker
-- attending 'going') so it blocks availability everywhere, incl. imported
-- calendars' consumers. All mutations go through SECURITY DEFINER RPCs.
-- NOT auto-applied. Run in the Supabase SQL editor. Additive.
-- ============================================================================

create table public.booking_types (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  description text not null default '',
  duration_min integer not null default 60 check (duration_min between 15 and 480),
  buffer_min integer not null default 0 check (buffer_min between 0 and 120),
  price text not null default '',
  location text not null default '',
  approval text not null default 'request' check (approval in ('request', 'instant')),
  audience text not null default 'everyone' check (audience in ('everyone', 'mycelium')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.booking_types enable row level security;

create policy "booking_types owner all" on public.booking_types
  for all to authenticated
  using (profile_id = auth.uid()) with check (profile_id = auth.uid());

-- Others see ACTIVE types they're invited to see: everyone, or the owner's
-- mycelium (owner → viewer edge; membership, not trust — the owner chose them).
create policy "booking_types visible" on public.booking_types
  for select to authenticated
  using (
    active and (
      audience = 'everyone'
      or exists (
        select 1 from public.mycelium m
        where m.truster_id = booking_types.profile_id
          and m.target_type = 'profile' and m.target_id = auth.uid())
    )
  );

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  type_id uuid not null references public.booking_types(id) on delete cascade,
  provider_id uuid not null references public.profiles(id) on delete cascade,
  booker_id uuid not null references public.profiles(id) on delete cascade,
  on_date date not null,
  start_min integer not null check (start_min between 0 and 1439),
  end_min integer not null check (end_min between 1 and 1440),
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'declined', 'cancelled')),
  note text not null default '',
  event_id uuid references public.events(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint bookings_span check (end_min > start_min)
);
alter table public.bookings enable row level security;
create index bookings_provider_date on public.bookings (provider_id, on_date);
create index bookings_booker on public.bookings (booker_id);

-- Participants read; every write goes through the RPCs below.
create policy "bookings participants read" on public.bookings
  for select to authenticated
  using (auth.uid() in (provider_id, booker_id));

-- ── Can this viewer see this type? (shared by the RPCs) ─────────────────────
create or replace function public.booking_type_visible(p_type uuid, p_viewer uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1 from public.booking_types t
    where t.id = p_type and t.active and (
      t.profile_id = p_viewer
      or t.audience = 'everyone'
      or (t.audience = 'mycelium' and exists (
        select 1 from public.mycelium m
        where m.truster_id = t.profile_id
          and m.target_type = 'profile' and m.target_id = p_viewer))
    ));
$$;

-- ── The raw materials for the slot picker ───────────────────────────────────
-- Windows + busy spans (events, imported calendars, held bookings) with NO
-- titles. Recurring events carry their recurrence jsonb — the client expands
-- with the same engine the calendar uses. Only revealed for bookable types.
create or replace function public.booking_board(p_type uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
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
      'approval', t.approval),
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
end; $$;
revoke all on function public.booking_board(uuid, date, date) from public, anon;
grant execute on function public.booking_board(uuid, date, date) to authenticated;

-- ── Book a slot ─────────────────────────────────────────────────────────────
create or replace function public.create_booking(
  p_type uuid, p_date date, p_start integer, p_note text default ''
) returns uuid language plpgsql security definer set search_path to 'public' as $$
declare t record; v_end integer; v_id uuid; v_event uuid;
        v_booker_name text; v_weekday int; v_ok boolean;
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

  -- Conflicts: held bookings + non-recurring events + imported busy.
  -- (Recurring-event conflicts are filtered by the slot picker; request-mode
  -- approval is the human backstop.)
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

  insert into public.bookings (type_id, provider_id, booker_id, on_date, start_min, end_min, status, note)
  values (p_type, t.profile_id, auth.uid(), p_date, p_start, v_end,
          case when t.approval = 'instant' then 'confirmed' else 'pending' end, coalesce(p_note, ''))
  returning id into v_id;

  select full_name into v_booker_name from public.profiles where id = auth.uid();

  if t.approval = 'instant' then
    insert into public.events (creator_id, owner_profile_id, title, description, location,
                               start_date, end_date, all_day, start_min, end_min)
    values (t.profile_id, t.profile_id, t.title || ' — ' || coalesce(v_booker_name, 'a member'),
            coalesce(p_note, ''), t.location, p_date, p_date, false, p_start, v_end)
    returning id into v_event;
    insert into public.event_attendees (event_id, profile_id, status, invited_by)
    values (v_event, auth.uid(), 'going', t.profile_id);
    update public.bookings set event_id = v_event where id = v_id;
    perform public.notify(t.profile_id, 'calendar', null, 'booking',
      coalesce(v_booker_name, 'A member') || ' booked ' || t.title,
      to_char(p_date, 'FMMon FMDD') || ' — it''s on your calendar.', '/bookings', auth.uid());
  else
    perform public.notify(t.profile_id, 'calendar', null, 'booking',
      coalesce(v_booker_name, 'A member') || ' requested ' || t.title,
      to_char(p_date, 'FMMon FMDD') || ' — accept or decline in Bookings.', '/bookings', auth.uid());
  end if;
  return v_id;
end; $$;
revoke all on function public.create_booking(uuid, date, integer, text) from public, anon;
grant execute on function public.create_booking(uuid, date, integer, text) to authenticated;

-- ── Provider answers a request ──────────────────────────────────────────────
create or replace function public.respond_booking(p_booking uuid, p_accept boolean)
returns void language plpgsql security definer set search_path to 'public' as $$
declare b record; t record; v_event uuid; v_booker_name text;
begin
  select * into b from public.bookings where id = p_booking;
  if b is null or b.provider_id <> auth.uid() then raise exception 'Not yours to answer'; end if;
  if b.status <> 'pending' then raise exception 'Already answered'; end if;
  select * into t from public.booking_types where id = b.type_id;
  if p_accept then
    select full_name into v_booker_name from public.profiles where id = b.booker_id;
    insert into public.events (creator_id, owner_profile_id, title, description, location,
                               start_date, end_date, all_day, start_min, end_min)
    values (b.provider_id, b.provider_id, t.title || ' — ' || coalesce(v_booker_name, 'a member'),
            b.note, t.location, b.on_date, b.on_date, false, b.start_min, b.end_min)
    returning id into v_event;
    insert into public.event_attendees (event_id, profile_id, status, invited_by)
    values (v_event, b.booker_id, 'going', b.provider_id);
    update public.bookings set status = 'confirmed', event_id = v_event where id = p_booking;
    perform public.notify(b.booker_id, 'calendar', null, 'booking',
      t.title || ' is confirmed',
      to_char(b.on_date, 'FMMon FMDD') || ' — it''s on your calendar.', '/bookings', auth.uid());
  else
    update public.bookings set status = 'declined' where id = p_booking;
    perform public.notify(b.booker_id, 'calendar', null, 'booking',
      t.title || ' — this time didn''t work',
      'Pick another slot whenever you like.', '/bookings', auth.uid());
  end if;
end; $$;
revoke all on function public.respond_booking(uuid, boolean) from public, anon;
grant execute on function public.respond_booking(uuid, boolean) to authenticated;

-- ── Either party cancels ────────────────────────────────────────────────────
create or replace function public.cancel_booking(p_booking uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare b record; t record; v_other uuid; v_name text;
begin
  select * into b from public.bookings where id = p_booking;
  if b is null or auth.uid() not in (b.provider_id, b.booker_id) then
    raise exception 'Not yours to cancel';
  end if;
  if b.status in ('cancelled', 'declined') then return; end if;
  select * into t from public.booking_types where id = b.type_id;
  if b.event_id is not null then delete from public.events where id = b.event_id; end if;
  update public.bookings set status = 'cancelled', event_id = null where id = p_booking;
  v_other := case when auth.uid() = b.provider_id then b.booker_id else b.provider_id end;
  select full_name into v_name from public.profiles where id = auth.uid();
  perform public.notify(v_other, 'calendar', null, 'booking',
    t.title || ' on ' || to_char(b.on_date, 'FMMon FMDD') || ' was cancelled',
    'Cancelled by ' || coalesce(v_name, 'the other member') || '.', '/bookings', auth.uid());
end; $$;
revoke all on function public.cancel_booking(uuid) from public, anon;
grant execute on function public.cancel_booking(uuid) to authenticated;
