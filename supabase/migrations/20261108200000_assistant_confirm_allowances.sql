-- CONFIRM, WITH AN ALWAYS-ALLOW — NEVER A WALL (founder 2026-11-08: "if you
-- need a user permission (e.g. when money changes hands…) that's fine - but
-- give them a 'don't ask me this in the future' or 'always allow'"; limits
-- set the same day: ⚡100 per purchase, ⚡300 per day, over ⚡500 waits 24h).
--
-- The assistant never moves anything on its own word. A tool PROPOSES (a row
-- here); the reply carries a confirm card; the PERSON's tap runs it through
-- confirm_assistant_proposal, optionally storing a standing allowance for
-- that kind. With an allowance, the next proposal of that kind runs straight
-- away — money only inside the ceilings. Everything executes AS the member
-- (auth context set to them) through the same rows/RPCs the manual buttons
-- use, so every trigger, CHECK and bell still applies.

create table if not exists public.assistant_proposals (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('send_currentcy','trust','recommend','weave','join_space','leave_space')),
  args jsonb not null default '{}'::jsonb,
  summary text not null,
  amount numeric,
  status text not null default 'pending' check (status in ('pending','held','done','cancelled','failed')),
  auto boolean not null default false,
  execute_after timestamptz,
  result text,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create index if not exists assistant_proposals_profile_idx on public.assistant_proposals (profile_id, created_at desc);
create index if not exists assistant_proposals_held_idx on public.assistant_proposals (execute_after) where status = 'held';
alter table public.assistant_proposals enable row level security;
drop policy if exists "assistant_proposals own read" on public.assistant_proposals;
create policy "assistant_proposals own read" on public.assistant_proposals
  for select using (profile_id = auth.uid());

create table if not exists public.assistant_allowances (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('send_currentcy','trust','recommend','weave','join_space','leave_space')),
  created_at timestamptz not null default now(),
  primary key (profile_id, kind)
);
alter table public.assistant_allowances enable row level security;
-- Read and REVOKE your own; there is deliberately no insert policy — an
-- allowance exists only because the person pressed Always allow.
drop policy if exists "assistant_allowances own read" on public.assistant_allowances;
create policy "assistant_allowances own read" on public.assistant_allowances
  for select using (profile_id = auth.uid());
drop policy if exists "assistant_allowances own revoke" on public.assistant_allowances;
create policy "assistant_allowances own revoke" on public.assistant_allowances
  for delete using (profile_id = auth.uid());

-- The one executor. Internal: runs as the proposal's member.
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
revoke all on function public._exec_assistant_proposal(uuid) from public, anon, authenticated;

-- Today's assistant money for a member, in their own timezone.
create or replace function public._assistant_money_today(p_profile uuid)
returns numeric
language sql security definer set search_path = public stable
as $f$
  select coalesce(sum(p.amount), 0)
    from assistant_proposals p, profiles pr
   where pr.id = p_profile and p.profile_id = p_profile and p.kind = 'send_currentcy'
     and p.status in ('done','held')
     and (p.created_at at time zone coalesce(pr.timezone, 'UTC'))::date
         = (now() at time zone coalesce(pr.timezone, 'UTC'))::date
$f$;
revoke all on function public._assistant_money_today(uuid) from public, anon, authenticated;

-- The assistant's door (service role only): record the ask, and run it now
-- only when a standing allowance covers it — money inside the ceilings.
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
revoke all on function public.assistant_run_or_propose(uuid, text, jsonb, text, numeric) from public, anon, authenticated;

-- The PERSON's tap.
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
  if p_always then
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
revoke all on function public.confirm_assistant_proposal(uuid, boolean) from public, anon;
grant execute on function public.confirm_assistant_proposal(uuid, boolean) to authenticated;

create or replace function public.cancel_assistant_proposal(p_id uuid)
returns text
language plpgsql security definer set search_path = public
as $f$
declare v record;
begin
  select * into v from assistant_proposals where id = p_id;
  if v.id is null or v.profile_id is distinct from auth.uid() then raise exception 'That ask isn''t yours.'; end if;
  if v.status not in ('pending','held') then return v.status; end if;
  update assistant_proposals set status = 'cancelled', decided_at = now() where id = p_id;
  return 'cancelled';
end $f$;
revoke all on function public.cancel_assistant_proposal(uuid) from public, anon;
grant execute on function public.cancel_assistant_proposal(uuid) to authenticated;

-- Held big purchases move when their 24 hours are up.
create or replace function public.tick_assistant_holds()
returns void
language plpgsql security definer set search_path = public
as $f$
declare r record; v_out text;
begin
  for r in select id, profile_id, summary from assistant_proposals
            where status = 'held' and execute_after <= now() order by execute_after limit 50
  loop
    v_out := public._exec_assistant_proposal(r.id);
    perform public.notify(r.profile_id, 'currentcy', null, 'currentcy',
      case when v_out = 'done' then 'Done: ' || r.summary else 'Didn''t go through: ' || r.summary end,
      case when v_out = 'done' then 'Your 24-hour hold ended and the Current moved.'
           else (select result from assistant_proposals where id = r.id) end,
      '/currentcy', null);
  end loop;
end $f$;
revoke all on function public.tick_assistant_holds() from public, anon, authenticated;

do $do$
begin
  perform cron.unschedule('tick-assistant-holds')
    where exists (select 1 from cron.job where jobname = 'tick-assistant-holds');
  perform cron.schedule('tick-assistant-holds', '*/10 * * * *', 'select public.tick_assistant_holds()');
end $do$;
