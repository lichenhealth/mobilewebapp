-- PROACTIVE NOTES NAME THEIR CONVERSATIONS (founder 2026-10-12: "Instead of
-- a long type ahead, can we have a pre-organized filler name, kinda like
-- untitled? So, Untitled Marketplace 1, Untitled Marketplace 2? I want to
-- urge people to organize their chats"). The client retires the first-words
-- derived title — an unnamed conversation now reads "Untitled «Thread» N" —
-- which would leave Claude's own proactive notes (load landed, transfer
-- failed, check-in, bug-fix announcement) as anonymous Untitleds in the
-- list. They know what they are, so they name themselves: each server-side
-- note writes a real row into assistant_convo_names alongside its convo.
-- The member can rename or clear it like any chosen name.

-- ── The note helper grows a title arm ────────────────────────────────────────
-- Signature change needs a drop (default param = new signature). plpgsql
-- resolves calls at execution time, so recreating the callers below is
-- belt-and-braces, not a requirement.
drop function if exists public._currentcy_claude_note(uuid, text);

create or replace function public._currentcy_claude_note(p_profile uuid, p_body text, p_title text default null)
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
  if p_title is not null then
    insert into assistant_convo_names (profile_id, convo_id, title)
    values (p_profile, v_convo, p_title)
    on conflict (profile_id, convo_id) do nothing;
  end if;
  return v_convo;
end $func$;
revoke execute on function public._currentcy_claude_note(uuid, text, text) from public, anon, authenticated;

-- ── LANDED (record_currentcy_load, unchanged except the note's title) ────────
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
    || 'If you were waiting on this one: all set.',
    'Load landed — ' || v_amt_txt || ' Current');

  perform public.notify(p_profile, 'currentcy', null, 'currentcy',
    v_amt_txt || ' Current landed in your wallet',
    'Your load cleared and is ready to use.',
    case when v_convo is not null
      then '/assistant/feed?thread=currentcy&convo=' || v_convo
      else '/currentcy' end,
    null);
  return v_ledger;
end $func$;

-- ── FAILED ───────────────────────────────────────────────────────────────────
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
    || 'trying again with a card lands instantly.',
    'Bank transfer didn''t go through');
  perform public.notify(new.profile_id, 'currentcy', null, 'currentcy',
    'Your bank transfer didn''t go through',
    'Nothing landed in your wallet — nothing was minted.',
    case when v_convo is not null
      then '/assistant/feed?thread=currentcy&convo=' || v_convo
      else '/currentcy' end,
    null);
  return new;
end $func$;

-- ── RUNNING LONG (the 4-business-day version from 20261012235000) ────────────
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
      || 'your bank account. I''ll tell you the moment it lands.',
      'Bank transfer check-in');
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

-- ── Dev-report "it's fixed" note names itself too ────────────────────────────
create or replace function public.on_dev_report_fixed()
returns trigger
language plpgsql security definer set search_path = public
as $func$
declare
  v_claude uuid := '85c04e7a-5a47-4c0e-85a4-0b35ff67a682';
  v_chat uuid;
  v_body text;
  v_convo uuid;
begin
  if new.status <> 'fixed' or old.status = 'fixed' then return new; end if;
  if new.autonomous then
    v_body := 'Good news — the issue reported here ("' || new.summary || '") should be fixed now. I''m running these fixes on my own; if something looks funny or isn''t working, say so here and we can bring Galyn into the conversation. 🌱';
  else
    v_body := 'Good news — the issue reported here ("' || new.summary || '") has been fixed by the builders. Thank you for flagging it; reports like this are how the platform gets better. 🌱';
  end if;
  if new.via like 'chat:%' then
    begin
      v_chat := nullif(split_part(new.via, ':', 3), '')::uuid;
    exception when others then
      v_chat := null;
    end;
    if v_chat is not null
       and exists (select 1 from public.chat_members m where m.chat_id = v_chat and m.profile_id = v_claude) then
      insert into public.chat_messages (chat_id, sender_id, body) values (v_chat, v_claude, v_body);
    end if;
  elsif new.via like 'feed:%' then
    -- A fresh conversation of its own (the email grammar), named so it never
    -- reads as an anonymous Untitled in the list.
    v_convo := gen_random_uuid();
    insert into public.assistant_feed_posts (profile_id, author, thread, body, convo_id)
    values (new.reporter_id, 'claude', substring(new.via from 6), v_body, v_convo);
    insert into public.assistant_convo_names (profile_id, convo_id, title)
    values (new.reporter_id, v_convo, 'Bug fix update')
    on conflict (profile_id, convo_id) do nothing;
  end if;
  return new;
end $func$;

-- ── Backfill: the proactive notes already written get their names ────────────
-- A proactive conversation is Claude-only; match by the templates' own first
-- words. on conflict do nothing — a name the member already chose stands.
insert into public.assistant_convo_names (profile_id, convo_id, title)
select distinct p.profile_id, p.convo_id,
  case
    when p.body like 'Good news — your load landed%' then 'Load landed'
    when p.body like 'Your $%bank transfer didn''t go through%' then 'Bank transfer didn''t go through'
    when p.body like 'Checking in on your $%bank transfer%' then 'Bank transfer check-in'
    when p.body like 'Good news — the issue reported here%' then 'Bug fix update'
  end
from public.assistant_feed_posts p
where p.author = 'claude' and p.convo_id is not null
  and (p.body like 'Good news — your load landed%'
    or p.body like 'Your $%bank transfer didn''t go through%'
    or p.body like 'Checking in on your $%bank transfer%'
    or p.body like 'Good news — the issue reported here%')
on conflict (profile_id, convo_id) do nothing;
