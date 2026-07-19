-- UNIVERSAL CURRENT-CY — Phase 1: the ledger (architecture settled with the
-- founder 2026-07-18: transparent DB ledger + dollar peg + Stripe Connect
-- payouts later; NO blockchain — "transparent ledger, trusted steward").
--
-- Principles baked in:
--  * APPEND-ONLY. No update/delete ever — a trigger refuses both, even for
--    privileged mistakes. Corrections are offsetting 'adjustment' entries.
--  * POLYMORPHIC ENTITIES ('profile' | 'space' today) so the multi-species
--    generalization (Tango, Huachuma) lands later without schema change.
--  * RPC-ONLY WRITES. send_currentcy() (race-safe balance check) and
--    admin-only mint_currentcy(). No INSERT policy exists at all.
--  * NO LEADERBOARDS BY CONSTRUCTION: you may read entries you're party to
--    and balances you own (or spaces you belong to); admins see all. Nobody
--    can query someone else's wealth — same anti-gamification stance as trust.

create table public.ledger_entries (
  id uuid primary key default gen_random_uuid(),
  from_type text check (from_type in ('profile', 'space')),
  from_id uuid,                          -- NULL pair = minted by Lichen
  to_type text not null check (to_type in ('profile', 'space')),
  to_id uuid not null,
  amount numeric(12,2) not null check (amount > 0),
  context text not null default 'exchange'
    check (context in ('mint', 'grant', 'gift', 'exchange', 'contribution', 'adjustment')),
  memo text not null default '',
  ref_type text,                         -- optional pointer to what occasioned it
  ref_id uuid,                           --   (a post, booking, event…)
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  check ((from_type is null) = (from_id is null))
);

create index ledger_from_idx on public.ledger_entries (from_type, from_id, created_at desc);
create index ledger_to_idx   on public.ledger_entries (to_type, to_id, created_at desc);

alter table public.ledger_entries enable row level security;

-- The ledger never rewrites history.
create or replace function public.ledger_no_rewrite()
returns trigger language plpgsql as $$
begin
  raise exception 'The ledger is append-only — record an adjustment entry instead.';
end $$;
create trigger ledger_no_rewrite
  before update or delete on public.ledger_entries
  for each row execute function public.ledger_no_rewrite();

-- Read: parties to the entry (their profile, or spaces they belong to) + admins.
create policy ledger_read on public.ledger_entries for select to authenticated using (
  (from_type = 'profile' and from_id = auth.uid())
  or (to_type = 'profile' and to_id = auth.uid())
  or (from_type = 'space' and exists (
        select 1 from public.space_members m where m.space_id = from_id and m.profile_id = auth.uid()))
  or (to_type = 'space' and exists (
        select 1 from public.space_members m where m.space_id = to_id and m.profile_id = auth.uid()))
  or exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin)
);
-- No insert/update/delete policies on purpose: writes go through the RPCs below.

-- Your balance (or a space's, if you belong to it; admins any). Everyone else: refused.
create or replace function public.ledger_balance(p_type text, p_id uuid)
returns numeric language plpgsql stable security definer set search_path = public as $$
declare v numeric;
begin
  if not (
    (p_type = 'profile' and p_id = auth.uid())
    or (p_type = 'space' and exists (
          select 1 from space_members m where m.space_id = p_id and m.profile_id = auth.uid()))
    or exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin)
  ) then
    raise exception 'Balances are private to their holders.';
  end if;
  select coalesce(sum(case when to_type = p_type and to_id = p_id then amount else 0 end), 0)
       - coalesce(sum(case when from_type = p_type and from_id = p_id then amount else 0 end), 0)
    into v
    from ledger_entries
   where (to_type = p_type and to_id = p_id) or (from_type = p_type and from_id = p_id);
  return v;
end $$;

-- Send Current: from yourself, or from a space you admin. Race-safe via an
-- advisory lock per sender, so two simultaneous sends can't overdraw.
create or replace function public.send_currentcy(
  p_from_type text, p_from_id uuid,
  p_to_type text, p_to_id uuid,
  p_amount numeric, p_memo text default ''
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_bal numeric; v_sender text; v_amt numeric;
begin
  v_amt := round(coalesce(p_amount, 0), 2);
  if v_amt <= 0 then raise exception 'Amount must be positive.'; end if;

  if p_from_type = 'profile' then
    if p_from_id <> auth.uid() then raise exception 'You can only send from yourself.'; end if;
  elsif p_from_type = 'space' then
    if not exists (select 1 from space_members m
                    where m.space_id = p_from_id and m.profile_id = auth.uid()
                      and m.role in ('admin', 'super_admin')) then
      raise exception 'Only that group''s admins can send from it.';
    end if;
  else
    raise exception 'Unknown sender kind.';
  end if;

  if p_to_type = 'profile' then
    if not exists (select 1 from profiles where id = p_to_id) then raise exception 'No such member.'; end if;
  elsif p_to_type = 'space' then
    if not exists (select 1 from spaces where id = p_to_id) then raise exception 'No such group.'; end if;
  else
    raise exception 'Unknown recipient kind.';
  end if;
  if p_from_type = p_to_type and p_from_id = p_to_id then
    raise exception 'Sender and recipient are the same.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_from_type || ':' || p_from_id::text, 42));

  select coalesce(sum(case when to_type = p_from_type and to_id = p_from_id then amount else 0 end), 0)
       - coalesce(sum(case when from_type = p_from_type and from_id = p_from_id then amount else 0 end), 0)
    into v_bal
    from ledger_entries
   where (to_type = p_from_type and to_id = p_from_id)
      or (from_type = p_from_type and from_id = p_from_id);
  if v_bal < v_amt then
    raise exception 'Not enough Current — this account holds %.', trim(to_char(v_bal, 'FM999999990.##'));
  end if;

  insert into ledger_entries (from_type, from_id, to_type, to_id, amount, context, memo, created_by)
  values (p_from_type, p_from_id, p_to_type, p_to_id, v_amt, 'exchange', coalesce(p_memo, ''), auth.uid())
  returning id into v_id;

  if p_to_type = 'profile' then
    select coalesce(full_name, 'A member') into v_sender from profiles where id = auth.uid();
    perform public.notify(p_to_id, 'home', null, 'currentcy',
      v_sender || ' sent you ' || trim(to_char(v_amt, 'FM999999990.##')) || ' Current',
      nullif(coalesce(p_memo, ''), ''), '/profile', auth.uid());
  end if;
  return v_id;
end $$;

-- Admins bring Current into being (grants, gifts, corrections).
create or replace function public.mint_currentcy(
  p_to_type text, p_to_id uuid, p_amount numeric,
  p_memo text default '', p_context text default 'grant'
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_amt numeric;
begin
  if not exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'Only admins can mint Current.';
  end if;
  v_amt := round(coalesce(p_amount, 0), 2);
  if v_amt <= 0 then raise exception 'Amount must be positive.'; end if;
  if p_context not in ('mint', 'grant', 'gift', 'adjustment') then
    raise exception 'Context must be mint, grant, gift, or adjustment.';
  end if;
  if p_to_type = 'profile' then
    if not exists (select 1 from profiles where id = p_to_id) then raise exception 'No such member.'; end if;
  elsif p_to_type = 'space' then
    if not exists (select 1 from spaces where id = p_to_id) then raise exception 'No such group.'; end if;
  else
    raise exception 'Unknown recipient kind.';
  end if;

  insert into ledger_entries (from_type, from_id, to_type, to_id, amount, context, memo, created_by)
  values (null, null, p_to_type, p_to_id, v_amt, p_context, coalesce(p_memo, ''), auth.uid())
  returning id into v_id;

  if p_to_type = 'profile' then
    perform public.notify(p_to_id, 'home', null, 'currentcy',
      'Lichen granted you ' || trim(to_char(v_amt, 'FM999999990.##')) || ' Current',
      nullif(coalesce(p_memo, ''), ''), '/profile', auth.uid());
  end if;
  return v_id;
end $$;
