-- PRESENCE, GIVEN NOT TAKEN (founder 2026-07-19): the Home greeting's awake
-- count becomes tappable — revealing ONLY network members who CHOSE to be
-- seen. Same law as calendar titles and trust: visibility is granted, never
-- harvested. Default off; coarse ("awake recently", no timestamps); no
-- ambient dots anywhere else.

alter table public.profiles
  add column if not exists presence_visible boolean not null default false;

-- Who in MY network (web ∪ space co-members — the count's exact population)
-- is awake AND has chosen to be visible. Names only; no times.
create or replace function public.network_awake_list()
returns table(id uuid, full_name text, avatar_url text, headline text)
language sql stable security definer set search_path = 'public' as $$
  select distinct p.id, p.full_name, p.avatar_url, p.headline
  from public.profiles p
  where p.id <> auth.uid()
    and p.presence_visible
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
grant execute on function public.network_awake_list() to authenticated;

-- Own toggle, readable + writable by its owner only (profiles UPDATE policy
-- already covers own row; presence_visible rides the existing column grants).
grant select (presence_visible) on public.profiles to authenticated;
grant update (presence_visible) on public.profiles to authenticated;
