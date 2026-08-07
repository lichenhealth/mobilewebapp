-- YOU ARE IN THE ROOM (founder 2026-08-07: "I toggled to WAG and it says WAG is
-- resting. Shouldn't it say WAG is Awake because I'm acting as WAG and my light
-- is on?").
--
-- space_awake_count inherited `p.id <> auth.uid()` from network_awake_count,
-- where excluding yourself is right: "your network" means other people by
-- definition. A SPACE asks a different question — who among this community's
-- members is around — and if you're a member with your light lit, you are one
-- of them. Standing in the room and being told the room is empty is just wrong.
--
-- The list follows the same rule so the two can never disagree; a count of one
-- with no names under it would read as a bug.

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
      where (p.presence_visible or p.presence_lit_until > now())
        and p.last_seen_at > now() - interval '12 hours'
    )
  end;
$$;
revoke all on function public.space_awake_count(uuid) from public, anon;
grant execute on function public.space_awake_count(uuid) to authenticated;

-- `me` lets the panel say "you" instead of listing you like a stranger.
-- Adding an OUT column changes the row type, so the old one has to go first
-- (same rule that bit my_home in July — "cannot change return type").
drop function if exists public.space_awake_list(uuid);
create function public.space_awake_list(p_space uuid)
returns table(id uuid, full_name text, avatar_url text, headline text,
              lit boolean, me boolean)
language sql stable security definer set search_path = 'public' as $$
  select distinct p.id, p.full_name, p.avatar_url, p.headline,
         (p.presence_lit_until > now()) as lit,
         (p.id = auth.uid()) as me
  from public.profiles p
  join public.space_members m on m.profile_id = p.id and m.space_id = p_space
  where (p.presence_visible or p.presence_lit_until > now())
    and p.last_seen_at > now() - interval '12 hours'
    and exists (
      select 1 from public.space_members me2
      where me2.space_id = p_space and me2.profile_id = auth.uid()
    )
  order by p.full_name;
$$;
revoke all on function public.space_awake_list(uuid) from public, anon;
grant execute on function public.space_awake_list(uuid) to authenticated;
