-- "Off the network" → "Taken offline" (founder 2026-10-02: "what wording
-- will help people understand?"). The shelf now wears the same words as the
-- backstage door that puts things on it ("Take this group offline"), so the
-- bell says "offline" too and names the Profile section it links to.
-- Copy-only change to take_space_offline; every check and write is untouched.

create or replace function public.take_space_offline(p_space uuid)
returns void
language plpgsql security definer
set search_path to 'public'
as $func$
declare
  v_uid uuid := auth.uid();
  v_bal numeric;
  v_n int;
  v_name text;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  if not exists (select 1 from public.space_members
                  where space_id = p_space and profile_id = v_uid and role = 'super_admin') then
    raise exception 'only the super admin can do this';
  end if;
  select coalesce(sum(case when to_type = 'space' and to_id = p_space then amount else 0 end), 0)
       - coalesce(sum(case when from_type = 'space' and from_id = p_space then amount else 0 end), 0)
    into v_bal from public.ledger_entries
   where (to_type = 'space' and to_id = p_space) or (from_type = 'space' and from_id = p_space);
  if v_bal > 0 then
    raise exception 'The treasury still holds % Current — send it on first.', trim(to_char(v_bal, 'FM999999990.##'));
  end if;
  select count(*) into v_n from public.profiles where steward_space_id = p_space;
  if v_n > 0 then
    raise exception 'This space stewards % member(s) — hand them to another steward first.', v_n;
  end if;
  select count(*) into v_n from public.exchanges
   where (buyer_space_id = p_space or seller_space_id = p_space) and status in ('pending', 'accepted');
  if v_n > 0 then
    raise exception 'There are % open trade(s) with this space — finish or cancel them first.', v_n;
  end if;

  update public.spaces
     set status = 'offline', status_changed_at = now(), status_changed_by = v_uid
   where id = p_space and status = 'live'
   returning name into v_name;

  -- The bell says where the way back is, in the section's own words.
  perform public.notify(
    v_uid, 'profile', null, 'space_offline',
    v_name || ' is offline',
    'Held with everything intact. Put it back online any time from your Profile, under "Taken offline".',
    '/profile#offline', null);
end;
$func$;
