-- CATEGORY SECTIONS (founder 2026-07-28): the pickers split into two labeled
-- groups — the healing taxonomy all in one place (ignorable if you're not a
-- healer), everyday commerce in the other. Alphabetical within each.
-- The original seeds are the healing world; everything added by the
-- general-commerce migration (and future suggestions) is everyday.

alter table public.categories add column if not exists section text not null default 'everyday'
  check (section in ('healing', 'everyday'));

update public.categories set section = 'healing'
where domain in ('good', 'service')
  and id not in (
    'g_antiques_collectibles', 'g_electronics_tech', 'g_vehicles_auto',
    'g_tools_equipment', 'g_home_kitchen', 'g_patio_garden', 'g_baby_kids',
    'g_toys_games', 'g_sporting_goods', 'g_musical_instruments',
    'g_pet_supplies', 'g_bags_luggage',
    's_accounting_finance', 's_legal_admin', 's_agriculture_farming',
    's_architecture_design', 's_automotive', 's_business_consulting',
    's_cleaning', 's_computing_it', 's_software_dev', 's_construction_trades',
    's_childcare', 's_courier_delivery', 's_education_tutoring', 's_engineering',
    's_event_planning', 's_garden_landscaping', 's_house_pet_sitting',
    's_home_repair', 's_hospitality', 's_interior_design', 's_photo_video',
    's_property_mgmt', 's_transport_hauling', 's_veterinary',
    's_fitness_training', 's_cooking_catering'
  );
