-- GENERAL-COMMERCE CATEGORIES (founder 2026-07-28): the taxonomy was
-- healing-focused only — a whole economy needs plumbers, accountants, and
-- pickup trucks too (Figma 286-4961 / 286-3905 lists, deduped against the
-- live healing categories). Members can still suggest new ones; these just
-- make the common ground native.

insert into public.categories (id, domain, name, sort) values
  -- goods
  ('g_antiques_collectibles', 'good', 'Antiques & Collectibles',    101),
  ('g_electronics_tech',      'good', 'Electronics & Tech',         102),
  ('g_vehicles_auto',         'good', 'Vehicles & Auto Parts',      103),
  ('g_tools_equipment',       'good', 'Tools & Equipment',          104),
  ('g_home_kitchen',          'good', 'Home & Kitchen',             105),
  ('g_patio_garden',          'good', 'Patio & Garden',             106),
  ('g_baby_kids',             'good', 'Baby & Kids',                107),
  ('g_toys_games',            'good', 'Toys & Games',               108),
  ('g_sporting_goods',        'good', 'Sporting Goods',             109),
  ('g_musical_instruments',   'good', 'Musical Instruments',        110),
  ('g_pet_supplies',          'good', 'Pet Supplies',               111),
  ('g_bags_luggage',          'good', 'Bags & Luggage',             112),
  -- services
  ('s_accounting_finance',    'service', 'Accounting & Finance',          201),
  ('s_legal_admin',           'service', 'Legal & Administrative',        202),
  ('s_agriculture_farming',   'service', 'Agriculture & Farming',         203),
  ('s_architecture_design',   'service', 'Architecture & Design',         204),
  ('s_automotive',            'service', 'Automotive Services',           205),
  ('s_business_consulting',   'service', 'Business Consulting',           206),
  ('s_cleaning',              'service', 'Cleaning & Janitorial',         207),
  ('s_computing_it',          'service', 'Computing & IT',                208),
  ('s_software_dev',          'service', 'Software Development',          209),
  ('s_construction_trades',   'service', 'Construction & Trades',         210),
  ('s_childcare',             'service', 'Childcare & Daycare',           211),
  ('s_courier_delivery',      'service', 'Courier & Delivery',            212),
  ('s_education_tutoring',    'service', 'Education & Tutoring',          213),
  ('s_engineering',           'service', 'Engineering',                   214),
  ('s_event_planning',        'service', 'Event Planning & Management',   215),
  ('s_garden_landscaping',    'service', 'Garden & Landscaping',          216),
  ('s_house_pet_sitting',     'service', 'House & Pet Sitting',           217),
  ('s_home_repair',           'service', 'Home Maintenance & Repair',     218),
  ('s_hospitality',           'service', 'Hospitality',                   219),
  ('s_interior_design',       'service', 'Interior Design',               220),
  ('s_photo_video',           'service', 'Photography & Videography',     221),
  ('s_property_mgmt',         'service', 'Property Management',           222),
  ('s_transport_hauling',     'service', 'Transportation & Hauling',      223),
  ('s_veterinary',            'service', 'Veterinary',                    224),
  ('s_fitness_training',      'service', 'Fitness & Personal Training',   225),
  ('s_cooking_catering',      'service', 'Cooking & Catering',            226)
on conflict (id) do nothing;
