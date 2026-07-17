-- Location privacy: Town / County / State layers (founder, 2026-07-17).
-- The level ladder becomes: hidden < state < county < area (town) < exact.
-- Most-restrictive-wins tie-breaks use exactly that order. 'state' is
-- findable-not-pinnable: mappable_members returns NULL coordinates for it —
-- a label in search and on profiles, no dot on the map.
-- NOT auto-applied. Run in the Supabase SQL editor. Additive + idempotent.

-- ── profiles: county/state labels (NOT granted — my_home() pattern) ──────────
alter table public.profiles add column if not exists home_county text;
alter table public.profiles add column if not exists home_state text;

-- ── widen the level CHECK ────────────────────────────────────────────────────
alter table public.location_shares drop constraint if exists location_shares_level_check;
alter table public.location_shares add constraint location_shares_level_check
  check (level in ('hidden', 'state', 'county', 'area', 'exact'));

-- ── resolver: new restrictiveness order ──────────────────────────────────────
create or replace function public.location_level(p_owner uuid, p_viewer uuid, p_kind text default 'home')
returns text language plpgsql stable security definer set search_path to 'public' as $$
declare v text;
begin
  if p_owner = p_viewer then return 'exact'; end if;
  if p_viewer is null then return 'hidden'; end if;

  select level into v from public.location_shares
   where owner_id = p_owner and kind = p_kind
     and audience_type = 'profile' and audience_profile_id = p_viewer;
  if v is not null then return v; end if;

  select level into v
  from public.location_shares s
  where s.owner_id = p_owner and s.kind = p_kind and s.audience_type = 'space'
    and public.is_space_member(s.audience_space_id, p_owner)
    and public.is_space_member(s.audience_space_id, p_viewer)
  order by case s.level
    when 'hidden' then 0 when 'state' then 1 when 'county' then 2
    when 'area' then 3 else 4 end asc
  limit 1;
  if v is not null then return v; end if;

  select level into v from public.location_shares
   where owner_id = p_owner and kind = p_kind and audience_type = 'everyone';
  return coalesce(v, 'hidden');
end; $$;

-- ── owner reads own home incl. the new labels ────────────────────────────────
create or replace function public.my_home()
returns table (
  home_location text, home_lat double precision, home_lng double precision,
  home_area text, home_county text, home_state text
)
language sql stable security definer set search_path to 'public' as
$$ select home_location, home_lat, home_lng, home_area, home_county, home_state
   from public.profiles where id = auth.uid() $$;
revoke all on function public.my_home() from public, anon;
grant execute on function public.my_home() to authenticated;

-- ── per-viewer map/search resolution ─────────────────────────────────────────
-- exact: true coords + address · area: town label + ~5km grid ·
-- county: county label + ~25km grid · state: state label, NO coords.
create or replace function public.mappable_members()
returns table (
  id uuid, full_name text, avatar_url text, level text,
  lat double precision, lng double precision, place text
)
language sql stable security definer set search_path to 'public' as $$
  select p.id, p.full_name, p.avatar_url, lv.level,
         case lv.level
           when 'exact'  then p.home_lat
           when 'area'   then round((p.home_lat / 0.05)::numeric) * 0.05
           when 'county' then round((p.home_lat / 0.25)::numeric) * 0.25
           else null end as lat,
         case lv.level
           when 'exact'  then p.home_lng
           when 'area'   then round((p.home_lng / 0.05)::numeric) * 0.05
           when 'county' then round((p.home_lng / 0.25)::numeric) * 0.25
           else null end as lng,
         case lv.level
           when 'exact'  then p.home_location
           when 'area'   then p.home_area
           when 'county' then coalesce(p.home_county, p.home_state)
           else p.home_state end as place
  from public.profiles p
  cross join lateral (select public.location_level(p.id, auth.uid()) as level) lv
  where p.home_lat is not null and p.home_lng is not null
    and lv.level <> 'hidden';
$$;
revoke all on function public.mappable_members() from public, anon;
grant execute on function public.mappable_members() to authenticated;
