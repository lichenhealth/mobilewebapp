-- THE LEDGER LEARNS TO BURN (founder 2026-08-13, picking this over parking
-- phantom test cents forever).
--
-- The ledger could mint — from nowhere, to someone — but not the mirror:
-- to_type/to_id were NOT NULL, so Current could never leave circulation.
-- The doctrine is a 3-channel model, "mint in / ledger inside / fixed-peg
-- out", and OUT means redemption: Current burns when it's exchanged for
-- dollars. The float rule ("never mint more Current than donation dollars
-- actually held") is only checkable if redemptions actually reduce the
-- outstanding float. This gives the ledger that shape.
--
-- burn_currentcy is admin-only for now, exactly as mint_currentcy is — the
-- member-facing redemption flow (with the Stripe payout beside it) will
-- widen that DELIBERATELY when it exists, not by default today.

alter table public.ledger_entries
  alter column to_type drop not null,
  alter column to_id drop not null;

-- The mirror of the existing from-pairing check…
alter table public.ledger_entries
  drop constraint if exists ledger_entries_to_pair_check,
  add constraint ledger_entries_to_pair_check
    check ((to_type is null) = (to_id is null));

-- …and nothing→nothing is not an entry.
alter table public.ledger_entries
  drop constraint if exists ledger_entries_some_party_check,
  add constraint ledger_entries_some_party_check
    check (not (from_type is null and to_type is null));

-- 'burn' joins the context vocabulary (text-with-CHECK, per convention).
alter table public.ledger_entries
  drop constraint if exists ledger_entries_context_check,
  add constraint ledger_entries_context_check
    check (context = any (array['mint'::text, 'grant'::text, 'gift'::text,
                                'exchange'::text, 'contribution'::text,
                                'adjustment'::text, 'burn'::text]));

comment on column public.ledger_entries.context is
  'mint/grant/gift = Current entering circulation (from is null). burn = Current leaving it (to is null) — the redemption channel. exchange/contribution move it inside; adjustment corrects, since the ledger is append-only.';

-- ── Burn: the mirror of mint ────────────────────────────────────────────────
create or replace function public.burn_currentcy(
  p_from_type text, p_from_id uuid, p_amount numeric, p_memo text default ''
) returns uuid
language plpgsql security definer set search_path = 'public' as $func$
declare v_id uuid; v_amt numeric; v_bal numeric;
begin
  if not exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'Only admins can burn Current.';
  end if;
  v_amt := round(coalesce(p_amount, 0), 2);
  if v_amt <= 0 then raise exception 'Amount must be positive.'; end if;
  if p_from_type = 'profile' then
    if not exists (select 1 from profiles where id = p_from_id) then raise exception 'No such member.'; end if;
  elsif p_from_type = 'space' then
    if not exists (select 1 from spaces where id = p_from_id) then raise exception 'No such group.'; end if;
  else
    raise exception 'Unknown holder kind.';
  end if;

  -- Same lock keyspace as send_currentcy and complete_exchange: every spend
  -- from one party serializes, whichever door the money leaves by.
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
  values (p_from_type, p_from_id, null, null, v_amt, 'burn', coalesce(p_memo, ''), auth.uid())
  returning id into v_id;
  return v_id;
end $func$;
revoke all on function public.burn_currentcy(text, uuid, numeric, text) from public, anon;
grant execute on function public.burn_currentcy(text, uuid, numeric, text) to authenticated;

-- ── The float gauge tells the whole truth: minted MINUS burned ──────────────
create or replace function public.currentcy_float_summary() returns json
language plpgsql stable security definer set search_path to 'public' as $func$
declare v_circulation numeric; v_operating bigint;
begin
  if not exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'Admins only.';
  end if;
  select coalesce(sum(case when from_type is null then amount else 0 end), 0)
       - coalesce(sum(case when to_type is null then amount else 0 end), 0)
    into v_circulation
    from ledger_entries
   where from_type is null or to_type is null;
  select coalesce(sum(central_cents), 0) into v_operating
    from donations where central_cents is not null;
  return json_build_object(
    'circulation', v_circulation,
    'operating_cents', v_operating
  );
end $func$;
