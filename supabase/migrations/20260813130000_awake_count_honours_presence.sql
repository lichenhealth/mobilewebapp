-- THE COUNT AND THE LIST HAVE TO AGREE (found 2026-08-13, chasing the Home
-- greeting's door).
--
-- network_awake_list() only ever returns members who opted INTO presence
-- (presence_visible, or a lit candle). network_awake_count() forgot that
-- predicate — it counted anyone in your web seen in the last 12 hours,
-- opted in or not. Two things went wrong from that one omission:
--
--   * "Two in your web are awake" would open onto a list of one, or none.
--   * Worse, the missing one is exactly the person who turned presence OFF.
--     A count is coarse, but it is still the signal presence_visible governs
--     — being counted is being seen. Presence is a gift, never a status
--     (founder), and a gift nobody offered isn't ours to spend.
--
-- space_awake_count/space_awake_list already carry the predicate in both
-- halves; this brings the network pair in line with them. The count can only
-- go DOWN, and only by people who had already said no.

create or replace function public.network_awake_count()
returns integer language sql stable security definer set search_path = 'public' as $func$
  select count(distinct p.id)::int
  from public.profiles p
  where p.id <> auth.uid()
    and (p.presence_visible or p.presence_always_present
         or p.presence_lit_until > now())
    and p.last_seen_at > now() - interval '12 hours'
    and (
      p.id in (select m.target_id from public.mycelium m
               where m.truster_id = auth.uid() and m.target_type = 'profile')
      or p.id in (select m2.profile_id
                  from public.space_members m1
                  join public.space_members m2 on m2.space_id = m1.space_id
                  where m1.profile_id = auth.uid())
    );
$func$;
