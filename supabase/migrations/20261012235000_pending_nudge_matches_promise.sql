-- THE CHECK-IN FIRES WHEN THE PROMISE PASSES (founder 2026-10-12: "can we do
-- 4 days not 6? or directly after the standard, longest time it should
-- take?"): the wallet's pending note promises "expected by <created + 4
-- business days>" (expectedBy() in ledgerApi). The proactive check-in now
-- keys off that SAME date — the first 6-hour tick after the promised arrival
-- has passed — instead of a flat 6 days, so Claude never nudges before the
-- estimate and never sits on a late transfer for days after it.

-- Mirror of ledgerApi's expectedBy(): walk forward one day at a time,
-- counting only weekdays, until n business days have been added.
create or replace function public._plus_business_days(p_from timestamptz, p_days int)
returns timestamptz
language plpgsql immutable set search_path = public
as $func$
declare d timestamptz := p_from; added int := 0;
begin
  while added < p_days loop
    d := d + interval '1 day';
    if extract(isodow from d) < 6 then added := added + 1; end if;
  end loop;
  return d;
end $func$;
revoke execute on function public._plus_business_days(timestamptz, int) from public, anon, authenticated;

create or replace function public.tick_pending_load_checks()
returns void
language plpgsql security definer set search_path = public
as $func$
declare r record; v_amt_txt text; v_convo uuid;
begin
  for r in
    select id, profile_id, amount_cents, created_at from pending_loads
    where status = 'pending' and nudged_at is null
      and now() > public._plus_business_days(created_at, 4)
  loop
    v_amt_txt := trim(trailing '.' from trim(trailing '0' from
      to_char(round(r.amount_cents / 100.0, 2), 'FM999999990.00')));
    v_convo := public._currentcy_claude_note(r.profile_id,
      'Checking in on your $' || v_amt_txt || ' bank transfer from '
      || to_char(r.created_at, 'FMMonth DD')
      || ' — it hasn''t landed yet, and it''s now past the expected arrival '
      || '(about 4 business days). It may be worth a look at the payment in '
      || 'your bank account. I''ll tell you the moment it lands.');
    perform public.notify(r.profile_id, 'currentcy', null, 'currentcy',
      'Your bank transfer is running long',
      'Started ' || to_char(r.created_at, 'FMMonth DD') || ' and not landed yet.',
      case when v_convo is not null
        then '/assistant/feed?thread=currentcy&convo=' || v_convo
        else '/currentcy' end,
      null);
    update pending_loads set nudged_at = now() where id = r.id;
  end loop;
end $func$;
