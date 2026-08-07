-- PRESENCE FOLLOWS THE LAYER YOU'RE STANDING IN (founder 2026-08-06: "I want
-- each sub layer of the network — a community, a place — to have its own feed
-- where only those awake within that sub community are shown... you can always
-- see all of Lichen, or all of your mycelium, by going to that section").
--
-- network_awake_count/list answer "who in MY web is awake" — my-celium plus
-- everyone I share any space with. On a community's own page that's the wrong
-- question, and answering it there is what made Home claim Morgahn was inside
-- Countryman Stables.
--
-- These two answer the layer's question instead: who among THIS space's
-- members is awake. Same opt-ins, same 12-hour window, same names-only, no
-- timestamps — presence stays a gift, not a status.
--
-- You must be a member to ask. A space's roster is not public presence data,
-- and a stranger counting who's around inside a community is exactly the
-- ambient surveillance the one-panel rule exists to prevent.

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
      where p.id <> auth.uid()
        and (p.presence_visible or p.presence_lit_until > now())
        and p.last_seen_at > now() - interval '12 hours'
    )
  end;
$$;
revoke all on function public.space_awake_count(uuid) from public, anon;
grant execute on function public.space_awake_count(uuid) to authenticated;

create or replace function public.space_awake_list(p_space uuid)
returns table(id uuid, full_name text, avatar_url text, headline text, lit boolean)
language sql stable security definer set search_path = 'public' as $$
  select distinct p.id, p.full_name, p.avatar_url, p.headline,
         (p.presence_lit_until > now()) as lit
  from public.profiles p
  join public.space_members m on m.profile_id = p.id and m.space_id = p_space
  where p.id <> auth.uid()
    and (p.presence_visible or p.presence_lit_until > now())
    and p.last_seen_at > now() - interval '12 hours'
    and exists (
      select 1 from public.space_members me
      where me.space_id = p_space and me.profile_id = auth.uid()
    )
  order by p.full_name;
$$;
revoke all on function public.space_awake_list(uuid) from public, anon;
grant execute on function public.space_awake_list(uuid) to authenticated;
