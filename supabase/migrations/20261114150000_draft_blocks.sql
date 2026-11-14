-- Drafts plan, they don't block (founder 2026-11-14): an unblocked draft never counts as busy.
-- 'Block' on the calendar sets draft_blocks=true and the draft then holds the time like an event.
alter table public.events add column if not exists draft_blocks boolean not null default false;

CREATE OR REPLACE FUNCTION public.booking_board(p_type uuid, p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      'hours_kind', t.hours_kind,
      'slot_increment_min', t.slot_increment_min,
      'price_cents', t.price_cents,
      'allow_pay_later', t.allow_pay_later,
      'pay_methods', t.pay_methods,
      'provider_tz', (select timezone from public.profiles where id = t.profile_id)),
    'windows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'weekday', w.weekday, 'start_min', w.start_min, 'end_min', w.end_min,
        'valid_from', w.valid_from, 'valid_to', w.valid_to))
      from public.availability_windows w
      where case when t.hours_kind = 'custom'
                 then w.booking_type_id = t.id
                 else w.profile_id = t.profile_id and w.booking_type_id is null
                      and w.kind = case t.hours_kind when 'work' then 'available' else t.hours_kind end
            end), '[]'::jsonb),
    'conditions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'require', c.require,
        'readable', c.target_type = 'resource' or public.calendar_level(c.target_id, t.profile_id) <> 'hidden',
        'windows', case when c.target_type = 'profile' and public.calendar_level(c.target_id, t.profile_id) <> 'hidden'
          then coalesce((
            select jsonb_agg(jsonb_build_object(
              'weekday', w2.weekday, 'start_min', w2.start_min, 'end_min', w2.end_min,
              'valid_from', w2.valid_from, 'valid_to', w2.valid_to))
            from public.availability_windows w2
            where w2.profile_id = c.target_id and w2.kind = 'available' and w2.booking_type_id is null), '[]'::jsonb)
          else '[]'::jsonb end,
        'busy', case
          when c.target_type = 'resource' then coalesce((
            select jsonb_agg(rz) from (
              select rb.start_date, rb.end_date,
                     (rb.start_min is null) as all_day, rb.start_min, rb.end_min, null::jsonb as recurrence
              from public.resource_bookings rb
              where rb.resource_id = c.target_id and rb.status in ('pending', 'approved', 'confirmed')
                and rb.start_date <= p_to and rb.end_date >= p_from
              union all
              select e.start_date, e.end_date, e.all_day, e.start_min, e.end_min, e.recurrence
              from public.events e
              where (not e.is_draft or e.draft_blocks) and e.owner_resource_id = c.target_id
                and e.start_date <= p_to and (e.end_date >= p_from or e.recurrence is not null)
            ) rz), '[]'::jsonb)
          when public.calendar_level(c.target_id, t.profile_id) <> 'hidden' then coalesce((
            select jsonb_agg(pz) from (
              select e.start_date, e.end_date, e.all_day, e.start_min, e.end_min, e.recurrence
              from public.events e
              where (not e.is_draft or e.draft_blocks) and (e.owner_profile_id = c.target_id
                     or exists (select 1 from public.event_attendees a
                                where a.event_id = e.id and a.profile_id = c.target_id and a.status <> 'declined'))
                and e.start_date <= p_to and (e.end_date >= p_from or e.recurrence is not null)
              union all
              select b2.on_date, b2.on_date, false, b2.start_min, b2.end_min, null::jsonb
              from public.bookings b2
              where (b2.provider_id = c.target_id or b2.booker_id = c.target_id)
                and b2.status in ('pending', 'confirmed') and b2.on_date between p_from and p_to
              union all
              select xb.on_date, xb.on_date, xb.all_day, xb.start_min, xb.end_min, null::jsonb
              from public.external_busy xb
              where xb.profile_id = c.target_id and xb.on_date between p_from and p_to
            ) pz), '[]'::jsonb)
          else '[]'::jsonb end))
      from public.booking_type_conditions c where c.type_id = t.id), '[]'::jsonb),
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
        where (not e.is_draft or e.draft_blocks) and (e.owner_profile_id = t.profile_id
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
end; $function$
;

CREATE OR REPLACE FUNCTION public.create_booking(p_type uuid, p_date date, p_start integer, p_note text DEFAULT ''::text, p_answers jsonb DEFAULT NULL::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare t record; v_end integer; v_id uuid;
        v_booker_name text; v_seats int;
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
  if not public._booking_in_hours(p_type, p_date, p_start, v_end) then
    raise exception 'That time isn''t offered';
  end if;
  if not public._booking_conditions_ok(p_type, p_date, p_start, v_end) then
    raise exception 'That time isn''t open for this session — pick another';
  end if;

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
    where (not e.is_draft or e.draft_blocks) and e.owner_profile_id = t.profile_id and e.recurrence is null
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
$function$
;

CREATE OR REPLACE FUNCTION public.guest_create_booking(p_type uuid, p_date date, p_start integer, p_name text, p_email text, p_note text DEFAULT ''::text, p_answers jsonb DEFAULT NULL::jsonb, p_phone text DEFAULT NULL::text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_email text := nullif(lower(btrim(coalesce(p_email, ''))), ''); v_phone text := nullif(btrim(coalesce(p_phone, '')), ''); t record; v_end integer; v_id uuid; v_token text;
        v_seats int;
begin
  select * into t from public.booking_types where id = p_type and active and audience = 'public';
  if t is null then raise exception 'This session isn''t open to the public'; end if;
  if btrim(coalesce(p_name, '')) = '' then raise exception 'Your name, please'; end if;
  if v_email is not null and v_email !~ '^\S+@\S+\.\S+$' then
    raise exception 'That email doesn''t look complete';
  end if;
  if v_phone is not null and (length(regexp_replace(v_phone, '\D', '', 'g')) < 7 or v_phone ~ '[A-Za-z]') then
    raise exception 'That phone number doesn''t look complete';
  end if;
  if v_email is null and v_phone is null then
    raise exception 'An email or a phone number, so the host can reach you';
  end if;
  v_end := p_start + t.duration_min;
  if v_end > 1440 then raise exception 'Slot runs past midnight'; end if;
  if p_date < current_date then raise exception 'That day has passed'; end if;
  if p_answers is not null and jsonb_typeof(p_answers) <> 'array' then p_answers := null; end if;
  if p_answers is not null and pg_column_size(p_answers) > 16384 then
    raise exception 'Answers are too long';
  end if;

  if not public._booking_in_hours(p_type, p_date, p_start, v_end) then
    raise exception 'That time isn''t offered';
  end if;
  if not public._booking_conditions_ok(p_type, p_date, p_start, v_end) then
    raise exception 'That time isn''t open for this session — pick another';
  end if;

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
         and ((v_email is not null and b.guest_email = v_email) or (v_phone is not null and regexp_replace(b.guest_phone, '\D', '', 'g') = regexp_replace(v_phone, '\D', '', 'g')))) then
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
    where (not e.is_draft or e.draft_blocks) and e.owner_profile_id = t.profile_id and e.recurrence is null
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
                               status, note, answers, guest_name, guest_email, guest_phone)
  values (p_type, t.profile_id, null, p_date, p_start, v_end,
          case when t.approval = 'instant' then 'confirmed' else 'pending' end,
          coalesce(p_note, ''), p_answers, btrim(p_name), v_email, v_phone)
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
$function$
;

CREATE OR REPLACE FUNCTION public.reschedule_booking(p_booking uuid, p_date date, p_start integer)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare b record; t record; v_end integer;
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

  if not public._booking_in_hours(b.type_id, p_date, p_start, v_end) then
    raise exception 'That time isn''t offered';
  end if;
  if not public._booking_conditions_ok(b.type_id, p_date, p_start, v_end) then
    raise exception 'That time isn''t open for this session — pick another';
  end if;

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
    where (not e.is_draft or e.draft_blocks) and e.owner_profile_id = b.provider_id and e.recurrence is null
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
$function$
;

CREATE OR REPLACE FUNCTION public.guest_reschedule_booking(p_token text, p_date date, p_start integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare b record; t record; v_end integer;
        v_when text; v_seats int;
begin
  select * into b from public.bookings where guest_token = p_token and guest_name is not null;
  if b is null then raise exception 'This booking link isn''t valid'; end if;
  if b.status not in ('pending', 'confirmed') then
    raise exception 'This booking isn''t live any more';
  end if;
  select * into t from public.booking_types where id = b.type_id;
  v_end := p_start + t.duration_min;
  if v_end > 1440 then raise exception 'Slot runs past midnight'; end if;
  if p_date < current_date then raise exception 'That day has passed'; end if;

  if not public._booking_in_hours(b.type_id, p_date, p_start, v_end) then
    raise exception 'That time isn''t offered';
  end if;
  if not public._booking_conditions_ok(b.type_id, p_date, p_start, v_end) then
    raise exception 'That time isn''t open for this session — pick another';
  end if;

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
    where (not e.is_draft or e.draft_blocks) and e.owner_profile_id = b.provider_id and e.recurrence is null
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
$function$
;

CREATE OR REPLACE FUNCTION public._target_available(p_ttype text, p_target uuid, p_provider uuid, p_date date, p_start integer, p_end integer)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_weekday int; v_haswin boolean; v_inwin boolean; v_busy boolean;
begin
  v_weekday := extract(isodow from p_date)::int - 1;
  if p_ttype = 'resource' then
    select exists (
      select 1 from public.resource_bookings rb
      where rb.resource_id = p_target and rb.status in ('pending', 'approved', 'confirmed')
        and p_date between rb.start_date and rb.end_date
        and (rb.start_min is null or (coalesce(rb.start_min, 0) < p_end and coalesce(rb.end_min, 1440) > p_start))
    ) or exists (
      select 1 from public.events e
      where (not e.is_draft or e.draft_blocks) and e.owner_resource_id = p_target and e.recurrence is null
        and p_date between e.start_date and e.end_date
        and (e.all_day or (coalesce(e.start_min, 0) < p_end and coalesce(e.end_min, 1440) > p_start))
    ) into v_busy;
    return not v_busy;
  end if;

  -- A person the provider can't see is nobody's rule to read.
  if public.calendar_level(p_target, p_provider) = 'hidden' then return true; end if;

  select exists (select 1 from public.availability_windows w
                 where w.profile_id = p_target and w.kind = 'available' and w.booking_type_id is null)
    into v_haswin;
  if v_haswin then
    select exists (
      select 1 from public.availability_windows w
      where w.profile_id = p_target and w.kind = 'available' and w.booking_type_id is null
        and w.weekday = v_weekday
        and w.start_min <= p_start and w.end_min >= p_end
        and (w.valid_from is null or w.valid_from <= p_date)
        and (w.valid_to is null or w.valid_to >= p_date)
    ) into v_inwin;
    if not v_inwin then return false; end if;
  end if;

  select exists (
    select 1 from public.events e
    where (not e.is_draft or e.draft_blocks) and (e.owner_profile_id = p_target
           or exists (select 1 from public.event_attendees a
                      where a.event_id = e.id and a.profile_id = p_target and a.status <> 'declined'))
      and e.recurrence is null
      and p_date between e.start_date and e.end_date
      and (e.all_day or (coalesce(e.start_min, 0) < p_end and coalesce(e.end_min, 1440) > p_start))
  ) or exists (
    select 1 from public.bookings b
    where (b.provider_id = p_target or b.booker_id = p_target)
      and b.status in ('pending', 'confirmed') and b.on_date = p_date
      and b.start_min < p_end and b.end_min > p_start
  ) or exists (
    select 1 from public.external_busy x
    where x.profile_id = p_target and x.on_date = p_date
      and (x.all_day or (coalesce(x.start_min, 0) < p_end and coalesce(x.end_min, 1440) > p_start))
  ) into v_busy;
  return not v_busy;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.resource_busy(p_resource uuid)
 RETURNS TABLE(start_date date, end_date date, start_min integer, end_min integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select e.start_date, e.end_date, e.start_min, e.end_min
  from public.events e
  where (not e.is_draft or e.draft_blocks) and e.owner_resource_id = p_resource
    and e.end_date >= current_date - 1
  order by e.start_date;
$function$
;

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
    where l.level <> 'hidden' and e.poll_status is distinct from 'open'
      and (not e.is_draft or e.draft_blocks)
  ),
  attending as (
    select l.owner, l.level,
      e.start_date, e.end_date, e.all_day, e.start_min, e.end_min, e.recurrence, e.title, e.id
    from lv l
    join public.event_attendees a on a.profile_id = l.owner and a.status <> 'declined'
    join public.events e on e.id = a.event_id
    where l.level <> 'hidden' and e.poll_status is distinct from 'open'
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
