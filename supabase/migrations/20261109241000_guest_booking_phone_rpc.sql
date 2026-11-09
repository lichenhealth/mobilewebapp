-- guest_create_booking takes an email OR a phone (p_phone). Old 7-arg signature dropped — one PostgREST candidate.
drop function if exists public.guest_create_booking(uuid, date, integer, text, text, text, jsonb);
create function public.guest_create_booking(p_type uuid, p_date date, p_start integer, p_name text, p_email text, p_note text DEFAULT ''::text, p_answers jsonb DEFAULT NULL::jsonb, p_phone text DEFAULT NULL::text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $func$
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
$func$
;
revoke all on function public.guest_create_booking(uuid, date, integer, text, text, text, jsonb, text) from public;
grant execute on function public.guest_create_booking(uuid, date, integer, text, text, text, jsonb, text) to anon, authenticated;
