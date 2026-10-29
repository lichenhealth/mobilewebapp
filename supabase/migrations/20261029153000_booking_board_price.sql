-- booking_board carries the type's price_cents out to the pickers (payments,
-- founder 2026-10-29) — full body restated; public_booking_board delegates.
create or replace function public.booking_board(p_type uuid, p_from date, p_to date)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
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
              where e.owner_resource_id = c.target_id
                and e.start_date <= p_to and (e.end_date >= p_from or e.recurrence is not null)
            ) rz), '[]'::jsonb)
          when public.calendar_level(c.target_id, t.profile_id) <> 'hidden' then coalesce((
            select jsonb_agg(pz) from (
              select e.start_date, e.end_date, e.all_day, e.start_min, e.end_min, e.recurrence
              from public.events e
              where (e.owner_profile_id = c.target_id
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
end; $function$;
