-- The cash-out bells land AT the Payouts desk, not just on the admin page
-- (founder 2026-10-29, clicking a harness bell into the top of "Invite to
-- Lichen": "Just seems confusing") — the links gain #payouts and the desk
-- answers the anchor (the /invite#door pattern). Bodies restated with only
-- the link strings changed.
create or replace function public.request_cashout(p_amount numeric)
returns uuid language plpgsql security definer set search_path to 'public' as $fn$
declare v_amt numeric; v_bal numeric; v_burn uuid; v_id uuid; v_name text; v_admin record; v_amt_txt text;
begin
  if auth.uid() is null then raise exception 'Not signed in.'; end if;
  v_amt := round(coalesce(p_amount, 0), 2);
  if v_amt <= 0 then raise exception 'Amount must be positive.'; end if;

  perform pg_advisory_xact_lock(hashtextextended('profile:' || auth.uid()::text, 42));

  select coalesce(sum(case when to_type = 'profile' and to_id = auth.uid() then amount else 0 end), 0)
       - coalesce(sum(case when from_type = 'profile' and from_id = auth.uid() then amount else 0 end), 0)
    into v_bal
    from public.ledger_entries
   where (to_type = 'profile' and to_id = auth.uid())
      or (from_type = 'profile' and from_id = auth.uid());
  if v_bal < v_amt then
    raise exception 'Not enough Current — you hold %.', trim(to_char(v_bal, 'FM999999990.##'));
  end if;

  insert into public.ledger_entries (from_type, from_id, to_type, to_id, amount, context, memo, created_by)
  values ('profile', auth.uid(), null, null, v_amt, 'cashout',
          'Cash-out requested — dollars on the way', auth.uid())
  returning id into v_burn;

  insert into public.payout_requests (profile_id, amount, source, burn_ledger_id)
  values (auth.uid(), v_amt, 'manual', v_burn)
  returning id into v_id;

  v_amt_txt := trim(trailing '.' from trim(trailing '0' from to_char(v_amt, 'FM999999990.00')));
  select coalesce(full_name, 'A member') into v_name from public.profiles where id = auth.uid();
  for v_admin in select pr.id from public.profiles pr where pr.is_admin and pr.id <> auth.uid() loop
    perform public.notify(v_admin.id, 'currentcy', null, 'currentcy',
      v_name || ' requests a $' || v_amt_txt || ' cash-out',
      'The Payouts desk has it — one tap to settle.', '/admin/supporters#payouts', auth.uid());
  end loop;
  return v_id;
end $fn$;

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
         stripe_session_id = coalesce(stripe_session_id, p_session)
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
