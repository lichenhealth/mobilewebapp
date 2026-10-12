-- CLAUDE SPEAKS CURRENT-CY UPDATES PROACTIVELY (founder 2026-10-12: "have
-- Claude for my Current-cy proactively message me this update, and it shows
-- up as a notification for me under Current-cy but also in the master list").
-- Three lifecycle moments on a load — landed, failed, running long — each
-- writes a Claude message into the member's currentcy assistant thread and
-- rings ONE currentcy bell linking to that conversation (Home's bell is the
-- global scope, so the same row shows in the master list for free).
-- The message is templated, not a model call: deterministic, instant, no cap.

-- The overdue nudge fires once per pending row.
alter table public.pending_loads add column if not exists nudged_at timestamptz;

-- ── The one door for a proactive Claude money note ──────────────────────────
-- Honors the member's currentcy AI de-selection: consent off → NO Claude
-- message appears (the bell still rings — money news is theirs regardless;
-- only the assistant's voice respects the switch). Returns the conversation
-- id, or null when consent held it back.
create or replace function public._currentcy_claude_note(p_profile uuid, p_body text)
returns uuid
language plpgsql security definer set search_path = public
as $func$
declare v_convo uuid;
begin
  if exists (
    select 1 from assistant_consent
    where profile_id = p_profile and scope_type = 'section'
      and scope_id = 'currentcy' and enabled = false
  ) then
    return null;
  end if;
  v_convo := gen_random_uuid();
  insert into assistant_feed_posts (profile_id, author, body, thread, convo_id)
  values (p_profile, 'claude', p_body, 'currentcy', v_convo);
  return v_convo;
end $func$;
revoke execute on function public._currentcy_claude_note(uuid, text) from public, anon, authenticated;

-- ── LANDED: the mint announces itself ───────────────────────────────────────
-- record_currentcy_load now also (1) resolves the matching pending_loads row
-- (session id first, oldest profile+amount pending as the fallback — the
-- webhook's own flip logic, so an SQL-driven mint resolves the wallet's
-- pending display too) and (2) writes the Claude note; the existing bell's
-- link lands in that conversation when one was written.
create or replace function public.record_currentcy_load(p_profile uuid, p_amount_cents integer, p_session text)
returns uuid
language plpgsql security definer set search_path = public
as $func$
declare v_load uuid; v_ledger uuid; v_amt numeric; v_amt_txt text; v_convo uuid; v_pending uuid;
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

  -- Resolve the pending display (bank loads; a card load has no pending row).
  select id into v_pending from pending_loads
  where status = 'pending' and stripe_session_id = p_session;
  if v_pending is null then
    select id into v_pending from pending_loads
    where status = 'pending' and profile_id = p_profile and amount_cents = p_amount_cents
    order by created_at limit 1;
  end if;
  if v_pending is not null then
    update pending_loads set status = 'landed', resolved_at = now() where id = v_pending;
  end if;

  -- ⚠ to_char '.##' is not a valid pattern (it rounded 10.50 to "11" and
  -- 0.01 to "0" — found live 2026-10-02): format with real decimal digits,
  -- then strip trailing zeros and the orphan point.
  v_amt_txt := trim(trailing '.' from trim(trailing '0' from to_char(v_amt, 'FM999999990.00')));

  v_convo := public._currentcy_claude_note(p_profile,
    'Good news — your load landed. ' || v_amt_txt
    || ' Current is in your wallet now, ready to use, and the entry is on your statement. '
    || 'If you were waiting on this one: all set.');

  perform public.notify(p_profile, 'currentcy', null, 'currentcy',
    v_amt_txt || ' Current landed in your wallet',
    'Your load cleared and is ready to use.',
    case when v_convo is not null
      then '/assistant/feed?thread=currentcy&convo=' || v_convo
      else '/currentcy' end,
    null);
  return v_ledger;
end $func$;

-- ── FAILED: the webhook's status flip rings through a trigger ───────────────
-- (the flip is a direct table write in stripe-webhook — a trigger can't be
-- forgotten by code that doesn't know it exists, the page_versions lesson).
create or replace function public.on_pending_load_failed()
returns trigger
language plpgsql security definer set search_path = public
as $func$
declare v_amt_txt text; v_convo uuid;
begin
  v_amt_txt := trim(trailing '.' from trim(trailing '0' from
    to_char(round(new.amount_cents / 100.0, 2), 'FM999999990.00')));
  v_convo := public._currentcy_claude_note(new.profile_id,
    'Your $' || v_amt_txt || ' bank transfer didn''t go through — the bank declined or '
    || 'reversed it, so nothing landed in your wallet and no Current was minted. '
    || 'It may be worth a look at your bank account; if you still want the load, '
    || 'trying again with a card lands instantly.');
  perform public.notify(new.profile_id, 'currentcy', null, 'currentcy',
    'Your bank transfer didn''t go through',
    'Nothing landed in your wallet — nothing was minted.',
    case when v_convo is not null
      then '/assistant/feed?thread=currentcy&convo=' || v_convo
      else '/currentcy' end,
    null);
  return new;
end $func$;

drop trigger if exists pending_load_failed_note on public.pending_loads;
create trigger pending_load_failed_note
after update of status on public.pending_loads
for each row
when (new.status = 'failed' and old.status is distinct from 'failed')
execute function public.on_pending_load_failed();

-- ── RUNNING LONG: a once-per-row check-in past the estimate ─────────────────
-- The wallet promises ~4 business days; 6 calendar days past initiation with
-- no landing gets one proactive check-in, never a second.
create or replace function public.tick_pending_load_checks()
returns void
language plpgsql security definer set search_path = public
as $func$
declare r record; v_amt_txt text; v_convo uuid;
begin
  for r in
    select id, profile_id, amount_cents, created_at from pending_loads
    where status = 'pending' and nudged_at is null
      and created_at < now() - interval '6 days'
  loop
    v_amt_txt := trim(trailing '.' from trim(trailing '0' from
      to_char(round(r.amount_cents / 100.0, 2), 'FM999999990.00')));
    v_convo := public._currentcy_claude_note(r.profile_id,
      'Checking in on your $' || v_amt_txt || ' bank transfer from '
      || to_char(r.created_at, 'FMMonth DD')
      || ' — it hasn''t landed yet. Bank transfers usually clear in about 4 business '
      || 'days, so this one is running long. It may be worth a look at the payment in '
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
revoke execute on function public.tick_pending_load_checks() from public, anon, authenticated;

-- Every 6 hours at :40 (never :00 — the schedules rule).
select cron.schedule('tick-pending-load-checks', '40 */6 * * *',
  $$select public.tick_pending_load_checks()$$);
