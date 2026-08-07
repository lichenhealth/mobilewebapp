-- MATCH network_awake_list EXACTLY (found while verifying the self-inclusion
-- fix: the founder has "Always show I'm present" on and their own space still
-- labelled them "around" rather than present).
--
-- Two gaps, both from space_awake_* not copying the network version's
-- treatment of presence_always_present:
--   1. `lit` read only presence_lit_until, so the always-on candle never
--      showed as a candle inside a space.
--   2. The visibility test omitted it too — a member who turned the "around"
--      dot OFF but left "always present" ON was visible network-wide and
--      invisible in their own community. Presence should never depend on
--      which panel you happen to be looking at.

create or replace function public.space_awake_count(p_space uuid)
returns integer language sql stable security definer set search_path = 'public' as $$
  select case
    when not exists (
      select 1 from public.space_members me
      where me.space_id = p_space and me.profile_id = auth.uid()
    ) then 0
    else (
      select count(distinct p.id)::int
      from public.profiles p
      join public.space_members m on m.profile_id = p.id and m.space_id = p_space
      where (p.presence_visible or p.presence_always_present
             or p.presence_lit_until > now())
        and p.last_seen_at > now() - interval '12 hours'
    )
  end;
$$;
revoke all on function public.space_awake_count(uuid) from public, anon;
grant execute on function public.space_awake_count(uuid) to authenticated;

drop function if exists public.space_awake_list(uuid);
create function public.space_awake_list(p_space uuid)
returns table(id uuid, full_name text, avatar_url text, headline text,
              lit boolean, me boolean)
language sql stable security definer set search_path = 'public' as $$
  select distinct p.id, p.full_name, p.avatar_url, p.headline,
         (p.presence_always_present or p.presence_lit_until > now()) as lit,
         (p.id = auth.uid()) as me
  from public.profiles p
  join public.space_members m on m.profile_id = p.id and m.space_id = p_space
  where (p.presence_visible or p.presence_always_present
         or p.presence_lit_until > now())
    and p.last_seen_at > now() - interval '12 hours'
    and exists (
      select 1 from public.space_members me2
      where me2.space_id = p_space and me2.profile_id = auth.uid()
    )
  order by p.full_name;
$$;
revoke all on function public.space_awake_list(uuid) from public, anon;
grant execute on function public.space_awake_list(uuid) to authenticated;
