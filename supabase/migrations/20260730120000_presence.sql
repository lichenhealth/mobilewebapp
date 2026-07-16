-- Presence, softly (founder, 2026-07-16): the Home greeting's "N in your
-- network are awake" becomes real. profiles.last_seen_at is heartbeat-written
-- by the app (once on load + every 10 minutes) and DELIBERATELY gets no
-- column SELECT grant (email/phone pattern) — individual presence stays
-- private; the world only ever sees an aggregate count via this RPC.
-- "Awake" = active in the last 12 hours. "Your network" = your mycelium web
-- (profile targets) ∪ co-members of your spaces.

alter table public.profiles add column if not exists last_seen_at timestamptz;

create or replace function public.network_awake_count() returns integer
language sql stable security definer set search_path = 'public' as $$
  select count(distinct p.id)::int
  from public.profiles p
  where p.id <> auth.uid()
    and p.last_seen_at > now() - interval '12 hours'
    and (
      p.id in (select m.target_id from public.mycelium m
               where m.truster_id = auth.uid() and m.target_type = 'profile')
      or p.id in (select m2.profile_id
                  from public.space_members m1
                  join public.space_members m2 on m2.space_id = m1.space_id
                  where m1.profile_id = auth.uid())
    );
$$;

grant execute on function public.network_awake_count() to authenticated;
