-- =============================================================================
-- Home locations + location_shares — the founder-designed location privacy
-- model (Maps phase b; CLAUDE.md thread #9).
--
-- NOT auto-applied. Run in the Supabase SQL editor. Idempotent. Additive —
-- safe to run anytime before merging.
--
-- Model:
--   * Levels: hidden / area (town-level) / exact. DEFAULT IS HIDDEN — a home
--     address shows to NOBODY until its owner adds rules (unlike calendar's
--     'busy' default; location privacy is opt-in by design).
--   * Audiences: everyone / a space / a specific person (calendar_shares
--     shape). An EXCLUDE is simply a specific rule set to 'hidden'.
--   * Resolution: most-specific wins (person > space > everyone). At the
--     space tier, ties resolve to the MOST RESTRICTIVE level — this is the
--     "exclude beats include" rule, and it deliberately INVERTS
--     calendar_level's most-permissive choice.
--   * Enforcement is structural: home_* columns are NOT in profiles'
--     column-scoped SELECT grant (new columns start private). Coordinates
--     leave the table ONLY via the SECURITY DEFINER RPCs below, which apply
--     location_level() per viewer. 'area' returns the stored town label and
--     coordinates rounded to a ~5km grid.
--   * kind is 'home' only today; 'live' and 'service_area' arrive in later
--     phases without re-shaping the table.
-- =============================================================================

-- ── profiles: home fields (deliberately NOT granted) ─────────────────────────
alter table public.profiles add column if not exists home_location text;
alter table public.profiles add column if not exists home_lat double precision;
alter table public.profiles add column if not exists home_lng double precision;
alter table public.profiles add column if not exists home_area text;

-- ── location_shares ──────────────────────────────────────────────────────────
create table if not exists public.location_shares (
  id                  uuid primary key default gen_random_uuid(),
  owner_id            uuid not null references public.profiles(id) on delete cascade,
  kind                text not null default 'home' check (kind in ('home')),
  audience_type       text not null check (audience_type in ('everyone', 'space', 'profile')),
  audience_space_id   uuid references public.spaces(id) on delete cascade,
  audience_profile_id uuid references public.profiles(id) on delete cascade,
  level               text not null check (level in ('hidden', 'area', 'exact')),
  created_at          timestamptz not null default now(),
  constraint location_shares_audience_shape check (
    (audience_type = 'everyone' and audience_space_id is null and audience_profile_id is null)
    or (audience_type = 'space' and audience_space_id is not null and audience_profile_id is null)
    or (audience_type = 'profile' and audience_profile_id is not null and audience_space_id is null)
  )
);
alter table public.location_shares enable row level security;

create unique index if not exists location_shares_audience_uniq
  on public.location_shares (
    owner_id, kind, audience_type,
    coalesce(audience_space_id,   '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(audience_profile_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

drop policy if exists "location_shares owner all" on public.location_shares;
create policy "location_shares owner all" on public.location_shares
  for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- ── resolution ────────────────────────────────────────────────────────────────
create or replace function public.location_level(p_owner uuid, p_viewer uuid, p_kind text default 'home')
returns text language plpgsql stable security definer set search_path to 'public' as $$
declare v text;
begin
  if p_owner = p_viewer then return 'exact'; end if;
  if p_viewer is null then return 'hidden'; end if;

  -- 1. explicit person rule (an exclude is this rule set to 'hidden')
  select level into v from public.location_shares
   where owner_id = p_owner and kind = p_kind
     and audience_type = 'profile' and audience_profile_id = p_viewer;
  if v is not null then return v; end if;

  -- 2. space rules over spaces BOTH belong to — MOST RESTRICTIVE wins
  --    (exclude beats include at equal specificity; inverts calendar_level)
  select level into v
  from public.location_shares s
  where s.owner_id = p_owner and s.kind = p_kind and s.audience_type = 'space'
    and public.is_space_member(s.audience_space_id, p_owner)
    and public.is_space_member(s.audience_space_id, p_viewer)
  order by case s.level when 'hidden' then 0 when 'area' then 1 else 2 end asc
  limit 1;
  if v is not null then return v; end if;

  -- 3. everyone rule, else the privacy-first default
  select level into v from public.location_shares
   where owner_id = p_owner and kind = p_kind and audience_type = 'everyone';
  return coalesce(v, 'hidden');
end; $$;
alter function public.location_level(uuid, uuid, text) owner to postgres;
revoke all on function public.location_level(uuid, uuid, text) from public, anon;
grant execute on function public.location_level(uuid, uuid, text) to authenticated;

-- ── owner reads own home (columns aren't granted — my_phone pattern) ─────────
create or replace function public.my_home()
returns table (home_location text, home_lat double precision, home_lng double precision, home_area text)
language sql stable security definer set search_path to 'public' as
$$ select home_location, home_lat, home_lng, home_area from public.profiles where id = auth.uid() $$;
alter function public.my_home() owner to postgres;
revoke all on function public.my_home() from public, anon;
grant execute on function public.my_home() to authenticated;

-- ── the People layer: members visible to THIS viewer, at their level ─────────
create or replace function public.mappable_members()
returns table (
  id uuid, full_name text, avatar_url text, level text,
  lat double precision, lng double precision, place text
)
language sql stable security definer set search_path to 'public' as $$
  select p.id, p.full_name, p.avatar_url, lv.level,
         case when lv.level = 'exact' then p.home_lat
              else round((p.home_lat / 0.05)::numeric) * 0.05 end as lat,
         case when lv.level = 'exact' then p.home_lng
              else round((p.home_lng / 0.05)::numeric) * 0.05 end as lng,
         case when lv.level = 'exact' then p.home_location else p.home_area end as place
  from public.profiles p
  cross join lateral (select public.location_level(p.id, auth.uid()) as level) lv
  where p.home_lat is not null and p.home_lng is not null
    and lv.level <> 'hidden';
$$;
alter function public.mappable_members() owner to postgres;
revoke all on function public.mappable_members() from public, anon;
grant execute on function public.mappable_members() to authenticated;
