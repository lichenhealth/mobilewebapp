-- CLEAR TRUST FROM SPACES (founder 2026-08-07, explicit yes to a destructive
-- change: "let's clear it. I think the confusion risks outweigh the benefits of
-- deleting someone's actions with so few users thus far").
--
-- Trust is now person-to-person only; an organisation is recommended, not
-- vouched for. The UI stopped offering it, but 18 existing vouches across 14
-- spaces would have kept feeding search's "trusted by" degrees with a signal
-- nobody can see, check or withdraw. At this size, clearing beats explaining.
--
-- THIS CLEARS THE VOUCH, NOT THE EDGE. Deleting the rows would unweave every
-- one of those spaces from members' my-celium — a much larger destruction than
-- was asked for, and silent. The 20 space edges all remain; 18 of them simply
-- stop claiming trust.
--
-- Person vouches (15) and post vouches (0) are untouched.

update public.mycelium
   set vouched = false
 where target_type = 'space'
   and vouched;

do $$
declare v_space_vouch int; v_space_edges int; v_person_vouch int;
begin
  select count(*) filter (where target_type = 'space' and vouched),
         count(*) filter (where target_type = 'space'),
         count(*) filter (where target_type = 'profile' and vouched)
    into v_space_vouch, v_space_edges, v_person_vouch
    from public.mycelium;

  if v_space_vouch <> 0 then
    raise exception 'space vouches remain: %', v_space_vouch;
  end if;
  if v_space_edges <> 20 then
    raise exception 'space edges changed — expected 20, found %', v_space_edges;
  end if;
  if v_person_vouch <> 15 then
    raise exception 'person vouches changed — expected 15, found %', v_person_vouch;
  end if;

  raise notice 'cleared. % space edges intact, % person vouches untouched',
    v_space_edges, v_person_vouch;
end $$;
