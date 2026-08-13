-- A SPACE THAT GETS PAID SHOULD HEAR ABOUT IT (founder 2026-08-13, building
-- the marketplace pay door: "communities may have their own current-cy, so an
-- admin can buy on behalf of that community").
--
-- send_currentcy already does everything the pay path needs — admin-only
-- space sends, advisory-lock balance check, no overdraft — but its receipt
-- bell only fired for PROFILE recipients. A community treasury could be paid
-- and no steward would ever hear it. Same function, same signature, one
-- addition: when the recipient is a space, bell its admins, linking to the
-- backstage where the space's Current-cy card lives.

CREATE OR REPLACE FUNCTION public.send_currentcy(p_from_type text, p_from_id uuid, p_to_type text, p_to_id uuid, p_amount numeric, p_memo text DEFAULT ''::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $func$
declare v_id uuid; v_bal numeric; v_sender text; v_amt numeric; v_space text; v_admin record;
begin
  v_amt := round(coalesce(p_amount, 0), 2);
  if v_amt <= 0 then raise exception 'Amount must be positive.'; end if;

  if p_from_type = 'profile' then
    if public.is_minor(auth.uid()) then raise exception 'A guardian sends on your behalf — ask a grown-up who holds your account.'; end if;
  if p_from_id <> auth.uid() and not public.is_entity_steward(p_from_id, auth.uid()) then raise exception 'You can only send from yourself, or from a being you steward.'; end if;
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

  -- The sender's name reads as whoever the money actually came FROM: the
  -- space when a treasury paid, the human otherwise.
  if p_from_type = 'space' then
    select name into v_sender from spaces where id = p_from_id;
  else
    select coalesce(full_name, 'A member') into v_sender from profiles where id = auth.uid();
  end if;

  if p_to_type = 'profile' then
    perform public.notify(p_to_id, 'home', null, 'currentcy',
      v_sender || ' sent you ' || trim(to_char(v_amt, 'FM999999990.##')) || ' Current',
      nullif(coalesce(p_memo, ''), ''), '/profile', auth.uid());
  else
    -- A space's money is stewarded, not owned — every admin hears, and the
    -- bell opens the backstage where the space's Current-cy card lives.
    select name into v_space from spaces where id = p_to_id;
    for v_admin in
      select m.profile_id from space_members m
       where m.space_id = p_to_id and m.role in ('admin', 'super_admin')
         and m.profile_id <> auth.uid()
    loop
      perform public.notify(v_admin.profile_id, 'home', p_to_id, 'currentcy',
        v_sender || ' sent ' || coalesce(v_space, 'your group') || ' '
          || trim(to_char(v_amt, 'FM999999990.##')) || ' Current',
        nullif(coalesce(p_memo, ''), ''),
        '/spaces/' || p_to_id::text || '?manage=1', auth.uid());
    end loop;
  end if;
  return v_id;
end $func$;
