-- Mycelium ≠ Trust (founder decisions 2026-07-14):
-- mycelium = your NETWORK (follow-like membership; posts flow to your feed);
-- trust = a PRIVATE per-person vouch layered on top (never counted).
-- Recommendations retarget to THINGS: posts/events/products/services/places.
-- Person + org/community/group recommendations meant "I vouch" — convert.

-- 1. The private vouch flag. Every existing edge came from a Trust button →
--    vouched. DEFAULT true also keeps not-yet-refreshed clients (which insert
--    without this column) writing what their button says: Trust.
alter table public.mycelium add column if not exists vouched boolean not null default true;

-- 2. Owners may edit their own edges (untrust without leaving the web).
create policy "mycelium: update own" on public.mycelium
  for update to authenticated
  using (truster_id = auth.uid()) with check (truster_id = auth.uid());

-- 3. Convert person / org / community / group recommendations into trust
--    edges (vouched), then remove them. Place + post recommendations stay.
insert into public.mycelium (truster_id, target_type, target_id, vouched)
select r.recommender_id, r.target_type, r.target_id, true
from public.recommendations r
left join public.spaces s on r.target_type = 'space' and s.id = r.target_id
where r.target_type = 'profile'
   or (r.target_type = 'space' and s.kind <> 'place')
on conflict (truster_id, target_type, target_id) do update set vouched = true;

delete from public.recommendations r
using public.spaces s
where r.target_type = 'space' and s.id = r.target_id and s.kind <> 'place';
delete from public.recommendations where target_type = 'profile';
