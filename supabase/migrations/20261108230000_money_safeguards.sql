-- THE MONEY SAFETY RAILS, PART TWO (founder 2026-11-08: "Can there be
-- overdraft controls, too? Claude will alert you if you're outpacing your
-- monthly budget, etc?" → "build the money safeguards").
--
-- (1) The pending period for big purchases already stands (over ⚡500 waits
--     24h — 20261108200000).
-- (2) THE OVERDRAFT FLOOR: profiles.currentcy_floor — "never take me below
--     ⚡N". Enforced by a BEFORE INSERT trigger on ledger_entries, so EVERY
--     money path honors it, manual or assistant, present or future (the
--     page_versions lesson: a rule enforced at call sites gets forgotten).
--     Exempt: cash-out (moving your own Current back to dollars is not
--     spending, and auto-cashout must keep working), burns and adjustments
--     (corrections). Null = no floor.
-- (3) BUDGET PACING: once a day, the money coach compares the month's real
--     Current-cy outflow against the planned monthly EXPENSES on the member's
--     BudgetCard and, when the month is running ahead of plan (or past it),
--     speaks one templated Claude note + a currentcy bell — each level at
--     most once a month. profiles.budget_pacing (default on) is the switch;
--     no planned expenses = no pacing.

alter table public.profiles
  add column if not exists currentcy_floor numeric check (currentcy_floor is null or (currentcy_floor >= 0 and currentcy_floor <= 1000000)),
  add column if not exists budget_pacing boolean not null default true;

create or replace function public._bolt_amt(p numeric)
returns text language sql immutable as $f$
  select regexp_replace(regexp_replace(to_char(round(coalesce(p, 0), 2), 'FM999999990.00'), '0+$', ''), '\.$', '')
$f$;

create or replace function public.enforce_currentcy_floor()
returns trigger
language plpgsql security definer set search_path = public
as $f$
declare v_floor numeric; v_bal numeric;
begin
  if new.from_type is distinct from 'profile' or new.from_id is null then return new; end if;
  if new.context in ('cashout', 'burn', 'adjustment') then return new; end if;
  select currentcy_floor into v_floor from profiles where id = new.from_id;
  if v_floor is null then return new; end if;
  select coalesce(sum(case when to_type = 'profile' and to_id = new.from_id then amount else 0 end), 0)
       - coalesce(sum(case when from_type = 'profile' and from_id = new.from_id then amount else 0 end), 0)
    into v_bal
    from ledger_entries
   where (to_type = 'profile' and to_id = new.from_id) or (from_type = 'profile' and from_id = new.from_id);
  if v_bal - new.amount < v_floor then
    raise exception 'That would take you below your floor of ⚡% (you hold ⚡%). Lower or clear your floor in Current-cy → Money safeguards, or load more first.',
      _bolt_amt(v_floor), _bolt_amt(v_bal);
  end if;
  return new;
end $f$;
revoke all on function public.enforce_currentcy_floor() from public, anon, authenticated;
drop trigger if exists ledger_currentcy_floor on public.ledger_entries;
create trigger ledger_currentcy_floor before insert on public.ledger_entries
  for each row execute function public.enforce_currentcy_floor();

-- The owner's read + write door (profiles' SELECT grant is column-scoped).
create or replace function public.my_money_safeguards()
returns jsonb language sql stable security definer set search_path = public as $f$
  select jsonb_build_object('floor', currentcy_floor, 'pacing', budget_pacing)
    from profiles where id = auth.uid()
$f$;
revoke all on function public.my_money_safeguards() from public, anon;
grant execute on function public.my_money_safeguards() to authenticated;

create or replace function public.set_money_safeguards(p_floor numeric, p_pacing boolean)
returns jsonb language plpgsql security definer set search_path = public as $f$
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if p_floor is not null and (p_floor < 0 or p_floor > 1000000) then
    raise exception 'A floor is a whole amount between ⚡0 and ⚡1,000,000.';
  end if;
  update profiles set currentcy_floor = nullif(p_floor, 0), budget_pacing = coalesce(p_pacing, budget_pacing)
   where id = auth.uid();
  return public.my_money_safeguards();
end $f$;
revoke all on function public.set_money_safeguards(numeric, boolean) from public, anon;
grant execute on function public.set_money_safeguards(numeric, boolean) to authenticated;

-- Claude may PROPOSE a floor (confirm card, never Always allow).
alter table public.assistant_proposals drop constraint if exists assistant_proposals_kind_check;
alter table public.assistant_proposals add constraint assistant_proposals_kind_check
  check (kind in ('send_currentcy','trust','recommend','weave','join_space','leave_space','set_floor'));

create or replace function public._exec_assistant_proposal(p_id uuid)
returns text
language plpgsql security definer set search_path = public
as $f$
declare v record; v_res text; v_hit int; v_role text;
begin
  select * into v from assistant_proposals where id = p_id for update;
  if v.id is null then return 'missing'; end if;
  if v.status not in ('pending','held') then return v.status; end if;
  -- Act AS the member for everything downstream (send_currentcy etc. read auth.uid()).
  perform set_config('request.jwt.claim.sub', v.profile_id::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v.profile_id::text, 'role', 'authenticated')::text, true);
  begin
    if v.kind = 'send_currentcy' then
      perform public.send_currentcy('profile', v.profile_id, v.args->>'to_type', (v.args->>'to_id')::uuid,
        (v.args->>'amount')::numeric, coalesce(v.args->>'memo', ''));
      v_res := 'sent';
    elsif v.kind = 'trust' then
      update mycelium set vouched = true
       where truster_id = v.profile_id and truster_space_id is null
         and target_type = v.args->>'target_type' and target_id = (v.args->>'target_id')::uuid;
      get diagnostics v_hit = row_count;
      if v_hit = 0 then
        insert into mycelium (truster_id, truster_space_id, target_type, target_id, vouched)
        values (v.profile_id, null, v.args->>'target_type', (v.args->>'target_id')::uuid, true)
        on conflict do nothing;
      end if;
      v_res := 'trusted';
    elsif v.kind = 'weave' then
      insert into mycelium (truster_id, truster_space_id, target_type, target_id, vouched)
      values (v.profile_id, null, v.args->>'target_type', (v.args->>'target_id')::uuid, false)
      on conflict do nothing;
      v_res := 'woven';
    elsif v.kind = 'recommend' then
      insert into recommendations (recommender_id, recommender_space_id, target_type, target_id, offering_category)
      values (v.profile_id, null, v.args->>'target_type', (v.args->>'target_id')::uuid, null)
      on conflict do nothing;
      v_res := 'recommended';
    elsif v.kind = 'join_space' then
      insert into space_membership_requests (space_id, profile_id, initiated_by)
      values ((v.args->>'space_id')::uuid, v.profile_id, v.profile_id)
      on conflict do nothing;
      v_res := 'asked to join';
    elsif v.kind = 'set_floor' then
      -- The member's own overdraft floor (null clears it). The floor is the
      -- member's to set; Claude only ever proposes, never with Always allow.
      update profiles set currentcy_floor = nullif((v.args->>'floor')::numeric, 0)
       where id = v.profile_id;
      v_res := case when coalesce((v.args->>'floor')::numeric, 0) = 0 then 'floor cleared' else 'floor set' end;
    elsif v.kind = 'leave_space' then
      select role::text into v_role from space_members
       where space_id = (v.args->>'space_id')::uuid and profile_id = v.profile_id;
      if v_role is null then raise exception 'You are not a member there anymore.'; end if;
      if v_role = 'super_admin' then raise exception 'You are its super admin — hand that role to someone else before leaving.'; end if;
      delete from space_members where space_id = (v.args->>'space_id')::uuid and profile_id = v.profile_id;
      v_res := 'left';
    end if;
    update assistant_proposals set status = 'done', result = v_res, decided_at = coalesce(decided_at, now()) where id = p_id;
    return 'done';
  exception when others then
    update assistant_proposals set status = 'failed', result = sqlerrm, decided_at = coalesce(decided_at, now()) where id = p_id;
    return 'failed: ' || sqlerrm;
  end;
end $f$;

create or replace function public.assistant_run_or_propose(
  p_profile uuid, p_kind text, p_args jsonb, p_summary text, p_amount numeric default null)
returns jsonb
language plpgsql security definer set search_path = public
as $f$
declare v_id uuid; v_allowed boolean; v_out text;
begin
  insert into assistant_proposals (profile_id, kind, args, summary, amount)
  values (p_profile, p_kind, coalesce(p_args, '{}'::jsonb), left(p_summary, 300), p_amount)
  returning id into v_id;
  select exists (select 1 from assistant_allowances where profile_id = p_profile and kind = p_kind) into v_allowed;
  -- A floor change ALWAYS waits on the person's tap: an Always-allow that let
  -- the assistant lower the floor would make the safeguard decorative.
  if p_kind = 'set_floor' then v_allowed := false; end if;
  if v_allowed and p_kind = 'send_currentcy' then
    v_allowed := coalesce(p_amount, 0) <= 100
             and public._assistant_money_today(p_profile) + coalesce(p_amount, 0) <= 300;
  end if;
  if not v_allowed then
    return jsonb_build_object('status', 'pending', 'id', v_id);
  end if;
  update assistant_proposals set auto = true where id = v_id;
  v_out := public._exec_assistant_proposal(v_id);
  return jsonb_build_object('status', case when v_out = 'done' then 'done' else 'failed' end,
                            'id', v_id, 'result', (select result from assistant_proposals where id = v_id));
end $f$;

create or replace function public.confirm_assistant_proposal(p_id uuid, p_always boolean default false)
returns jsonb
language plpgsql security definer set search_path = public
as $f$
declare v record; v_out text;
begin
  select * into v from assistant_proposals where id = p_id;
  if v.id is null or v.profile_id is distinct from auth.uid() then raise exception 'That ask isn''t yours.'; end if;
  if v.status <> 'pending' then return jsonb_build_object('status', v.status, 'result', v.result); end if;
  if v.created_at < now() - interval '7 days' then
    update assistant_proposals set status = 'cancelled', result = 'expired', decided_at = now() where id = p_id;
    raise exception 'That ask is more than a week old — ask Claude again.';
  end if;
  if p_always and v.kind <> 'set_floor' then
    insert into assistant_allowances (profile_id, kind) values (v.profile_id, v.kind) on conflict do nothing;
  end if;
  if v.kind = 'send_currentcy' and coalesce(v.amount, 0) > 500 then
    update assistant_proposals set status = 'held', execute_after = now() + interval '24 hours', decided_at = now()
     where id = p_id;
    return jsonb_build_object('status', 'held', 'execute_after', now() + interval '24 hours');
  end if;
  update assistant_proposals set decided_at = now() where id = p_id;
  v_out := public._exec_assistant_proposal(p_id);
  return jsonb_build_object('status', case when v_out = 'done' then 'done' else 'failed' end,
                            'result', (select result from assistant_proposals where id = p_id));
end $f$;

-- ── Budget pacing ─────────────────────────────────────────────────────────
create table if not exists public.budget_pacing_notes (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  month date not null,
  level text not null check (level in ('ahead', 'over')),
  created_at timestamptz not null default now(),
  primary key (profile_id, month, level)
);
alter table public.budget_pacing_notes enable row level security;
drop policy if exists "budget_pacing_notes own read" on public.budget_pacing_notes;
create policy "budget_pacing_notes own read" on public.budget_pacing_notes
  for select using (profile_id = auth.uid());

-- One member's pacing reading for the month they're in (their timezone).
create or replace function public._budget_pacing_state(p_profile uuid)
returns table (month date, planned numeric, spent numeric, day_of int, days_in int)
language sql stable security definer set search_path = public as $f$
  with tz as (
    select coalesce(timezone, 'UTC') as z from profiles where id = p_profile
  ), m as (
    select date_trunc('month', now() at time zone (select z from tz))::date as month,
           extract(day from now() at time zone (select z from tz))::int as day_of
  )
  select m.month,
    coalesce((select sum(case b.cadence
                when 'monthly' then b.amount_cents / 100.0
                when 'yearly' then b.amount_cents / 1200.0
                else case when b.on_date >= m.month and b.on_date < (m.month + interval '1 month')::date
                          then b.amount_cents / 100.0 else 0 end end)
                from budget_items b
               where b.profile_id = p_profile and b.bucket = 'expense' and b.amount_cents is not null), 0),
    coalesce((select sum(l.amount) from ledger_entries l
               where l.from_type = 'profile' and l.from_id = p_profile
                 and l.context not in ('cashout', 'burn', 'adjustment')
                 and (l.created_at at time zone (select z from tz))::date >= m.month), 0),
    m.day_of,
    extract(day from (m.month + interval '1 month' - interval '1 day'))::int
  from m
$f$;
revoke all on function public._budget_pacing_state(uuid) from public, anon, authenticated;

create or replace function public.tick_budget_pacing()
returns int
language plpgsql security definer set search_path = public
as $f$
declare r record; s record; v_level text; v_body text; v_title text; v_convo uuid; v_n int := 0;
begin
  for r in
    select distinct b.profile_id from budget_items b
      join profiles p on p.id = b.profile_id
     where b.bucket = 'expense' and b.amount_cents is not null and p.budget_pacing
  loop
    select * into s from public._budget_pacing_state(r.profile_id);
    if s.planned <= 0 then continue; end if;
    v_level := null;
    if s.spent > s.planned then
      v_level := 'over';
    elsif s.day_of >= 7 and s.spent >= s.planned * 0.5
          and s.spent > s.planned * (s.day_of::numeric / s.days_in) * 1.25 then
      v_level := 'ahead';
    end if;
    if v_level is null then continue; end if;
    -- 'over' supersedes a not-yet-sent 'ahead'; each level speaks once a month.
    if exists (select 1 from budget_pacing_notes n
                where n.profile_id = r.profile_id and n.month = s.month
                  and (n.level = v_level or (v_level = 'ahead' and n.level = 'over'))) then
      continue;
    end if;
    insert into budget_pacing_notes (profile_id, month, level) values (r.profile_id, s.month, v_level)
      on conflict do nothing;
    if v_level = 'over' then
      v_title := 'Past this month''s plan';
      v_body := 'A heads-up from your budget: ⚡' || _bolt_amt(s.spent) || ' of Current-cy has gone out so far this month, '
        || 'past the ⚡' || _bolt_amt(s.planned) || ' your budget plans for monthly expenses. Nothing is wrong with that — '
        || 'plans are for you, not the other way around. Want me to walk through where it went, or adjust the plan?';
    else
      v_title := 'Budget pacing';
      v_body := 'A quick check-in: ' || s.day_of || ' days into the month, ⚡' || _bolt_amt(s.spent)
        || ' of Current-cy has gone out — your budget plans about ⚡' || _bolt_amt(s.planned)
        || ' for the whole month, so you''re running ahead of pace. Want me to look at where it''s going?';
    end if;
    v_convo := public._currentcy_claude_note(r.profile_id, v_body, v_title);
    perform public.notify(r.profile_id, 'currentcy', null, 'budget_pacing',
      v_title, v_body,
      case when v_convo is not null then '/assistant/feed?thread=currentcy&convo=' || v_convo else '/currentcy' end,
      null);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $f$;
revoke all on function public.tick_budget_pacing() from public, anon, authenticated;

do $do$
begin
  perform cron.unschedule('tick-budget-pacing')
    where exists (select 1 from cron.job where jobname = 'tick-budget-pacing');
  perform cron.schedule('tick-budget-pacing', '23 17 * * *', 'select public.tick_budget_pacing()');
end $do$;
