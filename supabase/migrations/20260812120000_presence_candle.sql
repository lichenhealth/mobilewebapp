-- PRESENCE MODES (founder 2026-07-19): two ways to be seen —
--   * ALWAYS: presence_visible = true (whenever you're awake, you show)
--   * BY HAND: light your candle — visible for a few hours, then it fades
--     on its own (presence_lit_until). A manual choice that self-expires;
--     nobody appears forever by accident.
alter table public.profiles
  add column if not exists presence_lit_until timestamptz;

grant select (presence_lit_until) on public.profiles to authenticated;
grant update (presence_lit_until) on public.profiles to authenticated;

create or replace function public.network_awake_list()
returns table(id uuid, full_name text, avatar_url text, headline text)
language sql stable security definer set search_path = 'public' as $$
  select distinct p.id, p.full_name, p.avatar_url, p.headline
  from public.profiles p
  where p.id <> auth.uid()
    and (p.presence_visible or p.presence_lit_until > now())
    and p.last_seen_at > now() - interval '12 hours'
    and (
      p.id in (select m.target_id from public.mycelium m
               where m.truster_id = auth.uid() and m.target_type = 'profile')
      or p.id in (select m2.profile_id
                  from public.space_members m1
                  join public.space_members m2 on m2.space_id = m1.space_id
                  where m1.profile_id = auth.uid())
    )
  order by p.full_name;
$$;
