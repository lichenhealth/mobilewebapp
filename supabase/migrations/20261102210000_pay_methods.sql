-- HOW TO COLLECT PAYMENT (founder 2026-11-02, marking up the session editor:
-- "price should show up once you select payment as an option, as free means
-- that the price input is not applicable. Then there should also be a how to
-- collect online payment if its priced, with buttons to all the options -
-- credit card, venmo, etc"):
--
-- booking_types.pay_methods — the provider's OFF-PLATFORM ways to be paid
-- (Venmo / PayPal / Cash App / Zelle / free words), as a jsonb array of
-- {"kind","value"}. Card/bank through Lichen stays what it was —
-- price_cents + the Stripe checkout — this column only adds the pointers a
-- provider already hands out by hand today ("Sessions charged manually via
-- Ivy Pay"). Lichen never tracks whether an off-platform payment happened;
-- the doors show to bookers once a booking is CONFIRMED (the same
-- never-ask-before-the-provider's-yes posture as the card door) and step
-- aside once an online payment IS recorded.
--
-- Rides out through booking_board's type json (public_booking_board
-- delegates, so guests and vanity links inherit) and guest_booking
-- (RETURNS TABLE grows a column -> drop + recreate + re-grant).

alter table public.booking_types add column if not exists pay_methods jsonb;
alter table public.booking_types
  add constraint booking_types_pay_methods_array
  check (pay_methods is null or jsonb_typeof(pay_methods) = 'array');

-- booking_board: the one body (live def + the pay_methods line).
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
end; $function$

;

-- guest_booking: same columns as before + pay_methods.
drop function if exists public.guest_booking(text);
create function public.guest_booking(p_token text)
 returns table(guest_name text, status text, on_date date, start_min integer, end_min integer, note text, type_title text, type_location text, duration_min integer, provider_name text, type_id uuid, capacity integer, meeting_url text, approval text, price_cents integer, paid_at timestamp with time zone, pay_choice text, payment_pending_at timestamp with time zone, pay_methods jsonb)
 language sql
 stable security definer
 set search_path to 'public'
as $func$
  select b.guest_name, b.status, b.on_date, b.start_min, b.end_min, b.note,
         t.title, t.location, t.duration_min,
         coalesce(p.full_name, 'A Lichen member'),
         t.id, t.capacity,
         case when b.status = 'confirmed' then b.meeting_url end,
         t.approval, b.price_cents, b.paid_at,
         b.pay_choice, b.payment_pending_at,
         t.pay_methods
  from public.bookings b
  join public.booking_types t on t.id = b.type_id
  join public.profiles p on p.id = b.provider_id
  where b.guest_token = p_token and b.guest_email is not null;
$func$;
grant execute on function public.guest_booking(text) to anon, authenticated;
revoke execute on function public.guest_booking(text) from public;
