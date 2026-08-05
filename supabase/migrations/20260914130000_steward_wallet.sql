-- A being's steward can read and spend its Current-cy (founder 2026-08-05).
--
-- ledger_balance / my_statement / send_currentcy all guard on "you ARE the
-- holder", which is right for people and spaces but leaves a stewarded being's
-- wallet unreadable — Tango could earn and never spend. Stewardship is exactly
-- the delegation those guards were missing: is_entity_steward is the same shape
-- as the space_members check already sitting beside it.
--
-- Balances stay private by construction: no counts, no leaderboards, and a
-- steward sees only the beings they actually tend.

create or replace function public.ledger_balance(p_type text, p_id uuid)
returns numeric language plpgsql stable security definer set search_path = public as $func$
declare v numeric;
begin
  if not (
    (p_type = 'profile' and p_id = auth.uid())
    -- the steward reads the being's wallet as if it were their own
    or (p_type = 'profile' and public.is_entity_steward(p_id, auth.uid()))
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
  return coalesce(v, 0);
end $func$;

-- Sending FROM a being: same delegation, so a steward can pay the bodyworker
-- out of the horse's own earnings.
do $$
declare v_src text;
begin
  select pg_get_functiondef(oid) into v_src
    from pg_proc where proname = 'send_currentcy'
     and pronamespace = 'public'::regnamespace limit 1;
  if v_src is null then
    raise notice 'send_currentcy not found — skipping';
  elsif position('is_entity_steward' in v_src) > 0 then
    raise notice 'send_currentcy already delegates to stewards';
  else
    -- The guard is "you are the sender": widen it in place.
    v_src := replace(
      v_src,
      'if p_from_id <> auth.uid() then raise exception ''You can only send from yourself.''; end if;',
      'if p_from_id <> auth.uid() and not public.is_entity_steward(p_from_id, auth.uid()) then raise exception ''You can only send from yourself, or from a being you steward.''; end if;'
    );
    execute v_src;
    raise notice 'send_currentcy widened for stewards';
  end if;
end $$;
