-- TRAVEL (founder 2026-07-28): a life domain like Food and Art, not a new
-- mode. Stays ride the resources/booking machinery, rides ride the
-- marketplace's offer/ISO grammar — and the matcher already pairs
-- "ISO: ride to Denver Friday" with "Offering: Denver run, 3 seats" for free.

alter table public.posts drop constraint if exists posts_service_area_check;
alter table public.posts add constraint posts_service_area_check
  check (service_area = any (array['marketplace','work','courses','food','art',
                                   'events','places','library','people','travel']));

alter table public.posts drop constraint if exists posts_service_areas_valid;
alter table public.posts add constraint posts_service_areas_valid
  check (service_areas <@ array['marketplace','work','courses','food','art',
                                'events','places','library','people','travel']);

-- Two categories so travel listings tag themselves from day one.
insert into public.categories (id, domain, name, sort, section) values
  ('p_stays_lodging',    'place',   'Stays & Lodging',     15,  'everyday'),
  ('s_rides_carpooling', 'service', 'Rides & Carpooling',  227, 'everyday')
on conflict (id) do nothing;
