-- PRESENCE TIERS (founder, 2026-07-22): the awake panel distinguishes two
-- opt-in signals — "around" (presence_visible, a quiet peach dot) vs
-- "present / open to connect" (a hand-lit candle). Both already exist as the
-- two presence modes; the list just needs to say WHICH, so the UI can show a
-- dot vs a 🕯️. Adds a `lit` column; everything else is unchanged.

create or replace function public.network_awake_list()
returns table(id uuid, full_name text, avatar_url text, headline text, lit boolean)
language sql stable security definer set search_path = 'public' as $$
  select distinct p.id, p.full_name, p.avatar_url, p.headline,
         (p.presence_lit_until > now()) as lit
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
