-- PAYMENT OPTIONS (founder 2026-10-29: "can we have payment option? bank
-- transfer, card, invoice you later, etc"). Card + US bank transfer already
-- ride Stripe Checkout's dashboard-managed methods (the loads precedent) —
-- what this adds is honesty and choice around them:
-- (1) "INVOICE ME LATER": a priced booking may declare the intent to settle
--     later (bookings.pay_choice) — the provider sees "to be invoiced", the
--     guest's booking link stays the standing payment door, and a type can
--     switch the offer off (booking_types.allow_pay_later) to ask for
--     payment up front.
-- (2) BANK TRANSFERS IN TRANSIT: an ACH debit completes checkout unpaid and
--     clears days later (the 2026-10-02 loads lesson). bookings.
--     payment_pending_at marks the in-between so the pay door CLOSES while
--     the transfer rides (no double-pay), reopens if the bank returns it,
--     and the page says what's happening instead of re-asking for money.
alter table public.bookings
  add column if not exists pay_choice text
    check (pay_choice is null or pay_choice in ('now','later')),
  add column if not exists payment_pending_at timestamptz;
alter table public.booking_types
  add column if not exists allow_pay_later boolean not null default true;
comment on column public.booking_types.allow_pay_later is
  'Offer "invoice me later" at booking; false = payment asked up front.';

-- The booker's declared intent — token is a guest's whole authorization (the
-- /b/ pattern), a member must be the booking's own booker.
create or replace function public.set_booking_pay_choice(p_later boolean, p_token text default null, p_booking uuid default null)
returns void language plpgsql security definer set search_path to 'public' as $fn$
declare b record; v_allow boolean;
begin
  if p_token is not null then
    select * into b from public.bookings where guest_token = p_token and guest_email is not null;
  elsif p_booking is not null and auth.uid() is not null then
    select * into b from public.bookings where id = p_booking and booker_id = auth.uid();
  end if;
  if b is null then raise exception 'No such booking.'; end if;
  if b.paid_at is not null then raise exception 'Already paid — nothing to choose.'; end if;
  if b.price_cents is null then raise exception 'This booking has no online payment.'; end if;
  if p_later then
    select allow_pay_later into v_allow from public.booking_types where id = b.type_id;
    if not coalesce(v_allow, true) then
      raise exception 'This session asks for payment up front.';
    end if;
  end if;
  update public.bookings set pay_choice = case when p_later then 'later' else 'now' end
   where id = b.id;
end $fn$;
revoke all on function public.set_booking_pay_choice(boolean, text, uuid) from public;
grant execute on function public.set_booking_pay_choice(boolean, text, uuid) to anon, authenticated;

-- guest_booking carries the new state out (return shape changes → DROP).
drop function if exists public.guest_booking(text);
create function public.guest_booking(p_token text)
 returns table(guest_name text, status text, on_date date, start_min integer, end_min integer,
               note text, type_title text, type_location text, duration_min integer,
               provider_name text, type_id uuid, capacity integer, meeting_url text,
               approval text, price_cents integer, paid_at timestamptz,
               pay_choice text, payment_pending_at timestamptz)
 language sql stable security definer set search_path to 'public'
as $fn$
  select b.guest_name, b.status, b.on_date, b.start_min, b.end_min, b.note,
         t.title, t.location, t.duration_min,
         coalesce(p.full_name, 'A Lichen member'),
         t.id, t.capacity,
         case when b.status = 'confirmed' then b.meeting_url end,
         t.approval, b.price_cents, b.paid_at,
         b.pay_choice, b.payment_pending_at
  from public.bookings b
  join public.booking_types t on t.id = b.type_id
  join public.profiles p on p.id = b.provider_id
  where b.guest_token = p_token and b.guest_email is not null;
$fn$;
revoke all on function public.guest_booking(text) from public;
grant execute on function public.guest_booking(text) to anon, authenticated;

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
      'allow_pay_later', t.allow_pay_later,
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
-- record_booking_payment clears the in-transit mark when the mint lands.
create or replace function public.record_booking_payment(p_booking uuid, p_session text, p_amount_cents integer)
returns uuid language plpgsql security definer set search_path to 'public' as $fn$
declare b record; t record; v_pay uuid; v_ledger uuid; v_amt numeric; v_amt_txt text;
        v_payer text; v_pref text; v_burn uuid; v_admin record;
begin
  if p_booking is null or p_session is null or coalesce(p_amount_cents, 0) <= 0 then
    raise exception 'Bad payment.';
  end if;
  select * into b from public.bookings where id = p_booking;
  if b is null then raise exception 'No such booking.'; end if;
  select * into t from public.booking_types where id = b.type_id;

  insert into public.booking_payments (booking_id, amount_cents, stripe_session_id)
  values (p_booking, p_amount_cents, p_session)
  on conflict (stripe_session_id) do nothing
  returning id into v_pay;
  if v_pay is null then
    select ledger_entry_id into v_ledger from public.booking_payments where stripe_session_id = p_session;
    return v_ledger;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('profile:' || b.provider_id::text, 42));

  v_amt := round(p_amount_cents / 100.0, 2);
  insert into public.ledger_entries (from_type, from_id, to_type, to_id, amount, context, memo, ref_type, ref_id)
  values (null, null, 'profile', b.provider_id, v_amt, 'booking',
          'Session payment — ' || coalesce(t.title, 'a session'), 'booking', p_booking)
  returning id into v_ledger;
  update public.booking_payments set ledger_entry_id = v_ledger where id = v_pay;

  update public.bookings
     set paid_at = coalesce(paid_at, now()),
         stripe_session_id = coalesce(stripe_session_id, p_session),
         payment_pending_at = null
   where id = p_booking;

  v_amt_txt := trim(trailing '.' from trim(trailing '0' from to_char(v_amt, 'FM999999990.00')));
  select coalesce((select full_name from public.profiles where id = b.booker_id), b.guest_name, 'Someone')
    into v_payer;

  if b.status in ('cancelled', 'declined') then
    perform public.notify(b.provider_id, 'currentcy', null, 'currentcy',
      v_payer || ' paid $' || v_amt_txt || ' for a cancelled booking',
      'Arrange their refund — the payment is recorded on ' || coalesce(t.title, 'the session') || '.',
      '/bookings', null);
    return v_ledger;
  end if;

  select payout_pref into v_pref from public.profiles where id = b.provider_id;
  if v_pref = 'auto_cashout' then
    insert into public.ledger_entries (from_type, from_id, to_type, to_id, amount, context, memo, ref_type, ref_id)
    values ('profile', b.provider_id, null, null, v_amt, 'cashout',
            'Auto cash-out — session payment', 'booking', p_booking)
    returning id into v_burn;
    insert into public.payout_requests (profile_id, amount, source, burn_ledger_id)
    values (b.provider_id, v_amt, 'auto', v_burn);
    perform public.notify(b.provider_id, 'currentcy', null, 'currentcy',
      v_payer || ' paid $' || v_amt_txt || ' for ' || coalesce(t.title, 'your session'),
      'Queued for cash-out, as you chose — the dollars are on their way.', '/currentcy', null);
    for v_admin in select pr.id from public.profiles pr where pr.is_admin and pr.id <> b.provider_id loop
      perform public.notify(v_admin.id, 'currentcy', null, 'currentcy',
        'Cash-out to pay: $' || v_amt_txt,
        'A session payment queued for auto cash-out — the Payouts desk has it.',
        '/admin/supporters#payouts', null);
    end loop;
  else
    perform public.notify(b.provider_id, 'currentcy', null, 'currentcy',
      v_payer || ' paid $' || v_amt_txt || ' for ' || coalesce(t.title, 'your session'),
      v_amt_txt || ' Current is in your wallet — cash it out any time.', '/currentcy', null);
  end if;
  return v_ledger;
end $fn$;
