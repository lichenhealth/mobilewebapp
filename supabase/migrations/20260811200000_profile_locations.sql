-- Goods & Services addresses (founder 2026-08-11: "Have Home Address be an
-- option. But also Goods & Services Address(es) so you can add more than
-- one location.") — a member's ADDITIONAL locations beyond home: the studio,
-- the farm stand, the workshop. Unlike home (hidden by default, revealed
-- per-audience through location_shares), these are business addresses whose
-- whole point is being found — readable by any signed-in member, never anon.

create table profile_locations (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  label text not null default '',
  location text not null,
  lat double precision,
  lng double precision,
  created_at timestamptz not null default now()
);

comment on table profile_locations is 'A member''s goods & services addresses — deliberately public-to-members, unlike the privacy-laddered home location.';

create index profile_locations_profile_idx on profile_locations (profile_id);

alter table profile_locations enable row level security;

create policy "own locations: all" on profile_locations
  for all to authenticated
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

create policy "locations readable by members" on profile_locations
  for select to authenticated
  using (true);
