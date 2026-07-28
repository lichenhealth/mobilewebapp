-- PLACES & SPACES CATEGORIES (founder 2026-07-28, Figma 286-3905): the third
-- category domain — housing, land, venues. Powers the marketplace's category
-- dropdowns and listing tags; joins goods & services in every CategoryPicker.

alter table public.categories drop constraint if exists categories_domain_check;
alter table public.categories add constraint categories_domain_check
  check (domain = any (array['good'::text, 'service'::text, 'place'::text]));

alter table public.category_suggestions drop constraint if exists category_suggestions_domain_check;
alter table public.category_suggestions add constraint category_suggestions_domain_check
  check (domain = any (array['good'::text, 'service'::text, 'place'::text]));

insert into public.categories (id, domain, name, sort) values
  ('p_homes_for_sale',     'place', 'Homes for Sale',          1),
  ('p_homes_for_rent',     'place', 'Homes for Rent',          2),
  ('p_rooms_sublets',      'place', 'Rooms & Sublets',         3),
  ('p_land_acreage',       'place', 'Land & Acreage',          4),
  ('p_farms_ranches',      'place', 'Farms & Ranches',         5),
  ('p_venues_for_rent',    'place', 'Venues for Rent',         6),
  ('p_venues_for_sale',    'place', 'Venues for Sale',         7),
  ('p_offices_meeting',    'place', 'Offices & Meeting Rooms', 8),
  ('p_retreat_centers',    'place', 'Retreat Centers',         9),
  ('p_campgrounds',        'place', 'Campgrounds',             10),
  ('p_studios_galleries',  'place', 'Studios & Galleries',     11),
  ('p_gardens_fields',     'place', 'Gardens & Fields',        12),
  ('p_storage_warehouses', 'place', 'Storage & Warehouses',    13),
  ('p_natural_settings',   'place', 'Natural Settings',        14)
on conflict (id) do nothing;
