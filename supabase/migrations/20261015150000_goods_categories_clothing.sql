-- GOODS CATEGORIES — the Figma vocabulary + the Clothing tree (founder
-- 2026-10-15: "can we add clothing and have sub categories be clothing >
-- shirts, clothing > shoes, clothing > dresses, etc?" + "here are the list
-- of categories to ensure are available for Marketplace" — Figma node
-- 286:3496). Categories grow a HIERARCHY: parent_id (nullable, self-FK) —
-- a child is an ordinary category row whose picker row nests under its
-- parent. Same-shape Figma rows are REUSED, never duplicated (the Places
-- vocabulary rule): Apps & Tech/Electronics → Electronics & Tech, Arts &
-- Crafts → Art & Handcrafts, Auto Parts → Vehicles & Auto Parts, Baby →
-- Baby & Kids, Beauty → Skincare & Body Care, Jewelry & Watches → Jewelry
-- & Talismans, Nutrition & Supplements → Supplements & Vitamins, Luggage →
-- Bags & Luggage. "Apparel & Textiles" IS the clothing row — renamed
-- "Clothing & Apparel" so the word members search for leads, and it
-- becomes the parent of the new tree.

alter table public.categories
  add column if not exists parent_id text references public.categories(id) on delete set null;

-- The parent: reuse the existing apparel row under the name people type.
update public.categories set name = 'Clothing & Apparel' where id = 'g_apparel_textiles';

-- The Clothing tree (founder's shirts/shoes/dresses + the Figma's
-- menswear/womenswear/kidswear as children of the same parent).
insert into public.categories (id, domain, name, sort, section, parent_id) values
  ('g_c_shirts_tops',    'good', 'Shirts & Tops',      300, 'everyday', 'g_apparel_textiles'),
  ('g_c_pants_jeans',    'good', 'Pants & Jeans',      301, 'everyday', 'g_apparel_textiles'),
  ('g_c_dresses_skirts', 'good', 'Dresses & Skirts',   302, 'everyday', 'g_apparel_textiles'),
  ('g_c_shoes',          'good', 'Shoes',              303, 'everyday', 'g_apparel_textiles'),
  ('g_c_outerwear',      'good', 'Outerwear & Coats',  304, 'everyday', 'g_apparel_textiles'),
  ('g_c_activewear',     'good', 'Activewear',         305, 'everyday', 'g_apparel_textiles'),
  ('g_c_accessories',    'good', 'Accessories & Hats', 306, 'everyday', 'g_apparel_textiles'),
  ('g_c_menswear',       'good', 'Menswear',           307, 'everyday', 'g_apparel_textiles'),
  ('g_c_womenswear',     'good', 'Womenswear',         308, 'everyday', 'g_apparel_textiles'),
  ('g_c_kidswear',       'good', 'Kidswear',           309, 'everyday', 'g_apparel_textiles')
on conflict (id) do nothing;

-- Figma goods rows with no same-shape existing category.
insert into public.categories (id, domain, name, sort, section) values
  ('g_movies_music',   'good', 'Movies & Music',   320, 'everyday'),
  ('g_garage_sale',    'good', 'Garage Sale',      321, 'everyday'),
  ('g_homes_sale',     'good', 'Homes for Sale',   322, 'everyday'),
  ('g_housing_rentals','good', 'Housing Rentals',  323, 'everyday'),
  ('g_venues_rent',    'good', 'Venues for Rent',  324, 'everyday'),
  ('g_venues_sale',    'good', 'Venues for Sale',  325, 'everyday'),
  ('g_miscellaneous',  'good', 'Miscellaneous',    399, 'everyday')
on conflict (id) do nothing;
