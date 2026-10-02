-- THE LOAD BELL RINGS CURRENT-CY (founder 2026-10-02: "notifications exist
-- for Current-cy, too - so we'll get a little '1' for the currentcy bell
-- once the money posts"): record_currentcy_load already belled on a fresh
-- mint, but under section 'home' — the wallet's own bell stayed dark. The
-- bell is section 'currentcy' now (the nav badge + bell panel count it
-- there), and the ledger memo stops presuming a card — bank loads mint
-- through the same door since 2026-10-02.
-- Also fixes the amount formatting in the title (see inline note).
-- Idempotency untouched: a replayed session still returns the existing
-- mint without a second bell.

create or replace function public.record_currentcy_load(
  p_profile uuid, p_amount_cents integer, p_session text
) returns uuid
language plpgsql security definer set search_path to 'public'
as $func$
declare v_load uuid; v_ledger uuid; v_amt numeric;
begin
  if p_profile is null or p_session is null or coalesce(p_amount_cents, 0) <= 0 then
    raise exception 'Bad load.';
  end if;
  if not exists (select 1 from profiles where id = p_profile) then
    raise exception 'No such member.';
  end if;

  insert into currentcy_loads (profile_id, amount_cents, stripe_session_id)
  values (p_profile, p_amount_cents, p_session)
  on conflict (stripe_session_id) do nothing
  returning id into v_load;
  if v_load is null then
    -- Retry of an already-recorded session: answer with the existing mint.
    select ledger_entry_id into v_ledger from currentcy_loads where stripe_session_id = p_session;
    return v_ledger;
  end if;

  v_amt := round(p_amount_cents / 100.0, 2);
  insert into ledger_entries (from_type, from_id, to_type, to_id, amount, context, memo, ref_type, ref_id)
  values (null, null, 'profile', p_profile, v_amt, 'load', 'Loaded into your wallet', 'load', v_load)
  returning id into v_ledger;

  update currentcy_loads set ledger_entry_id = v_ledger where id = v_load;

  -- ⚠ to_char '.##' is not a valid pattern (it rounded 10.50 to "11" and
  -- 0.01 to "0" — found live 2026-10-02): format with real decimal digits,
  -- then strip trailing zeros and the orphan point.
  perform public.notify(p_profile, 'currentcy', null, 'currentcy',
    trim(trailing '.' from trim(trailing '0' from to_char(v_amt, 'FM999999990.00')))
      || ' Current landed in your wallet',
    'Your load cleared and is ready to use.', '/currentcy', null);
  return v_ledger;
end $func$;
