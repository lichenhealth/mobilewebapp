-- TRAVEL IS AN EXCHANGE + THE PLACES VOCABULARY (founder 2026-10-06:
-- "Build out travel like an exchange between private citizens who drive cars,
-- trucks, airplanes and helicopters - as well as any companies that want to
-- join in. Same for places to stay, retreat centers, event centers…" and
-- "Exchanging refrig truck delivery time and gas for fresh homemade ice
-- cream, exchanging an apt in SF for a villa in france").
--
-- Two pieces:
--   1. The Places vocabulary the founder supplied, loaded into the governed
--      place domain (existing near-duplicates kept as they are — "Farms &
--      Ranches" already covers "Farms", "Studios & Galleries" covers
--      "Galleries & Studios", "Storage & Warehouses" covers both storage
--      lines; "Homes (STR)" lands as the member-readable
--      "Homes (Short-term stays)").
--   2. The deterministic ISO matcher widens from marketplace-only to
--      marketplace + travel, and its lexeme text now includes a travel
--      post's structured facts (route endpoints, vehicle, ride/stay) so
--      "ISO ride to Santa Fe" rings the truck heading there even when the
--      offer's title never says the word "ride".

insert into public.categories (id, domain, name, sort, section) values
  ('p_amphitheaters_arenas', 'place', 'Amphitheaters & Arenas',      16, 'everyday'),
  ('p_bars_restaurants',     'place', 'Bars & Restaurants',          17, 'everyday'),
  ('p_beaches',              'place', 'Beaches',                     18, 'everyday'),
  ('p_boats_cruise_ships',   'place', 'Boats & Cruise Ships',        19, 'everyday'),
  ('p_cathedrals_churches',  'place', 'Cathedrals & Churches',       20, 'everyday'),
  ('p_community_centers',    'place', 'Community Centers',           21, 'everyday'),
  ('p_conference_centers',   'place', 'Conference Centers',          22, 'everyday'),
  ('p_convention_centers',   'place', 'Convention Centers',          23, 'everyday'),
  ('p_country_clubs',        'place', 'Country Clubs',               24, 'everyday'),
  ('p_homes_str',            'place', 'Homes (Short-term stays)',    25, 'everyday'),
  ('p_hotels',               'place', 'Hotels',                      26, 'everyday'),
  ('p_manufacturing',        'place', 'Manufacturing',               27, 'everyday'),
  ('p_movie_theaters',       'place', 'Movie Theaters',              28, 'everyday'),
  ('p_music_venues',         'place', 'Music Venues',                29, 'everyday'),
  ('p_parks_rec',            'place', 'Parks & Recreation Centers',  30, 'everyday'),
  ('p_performance_venues',   'place', 'Performance Venues',          31, 'everyday'),
  ('p_playgrounds',          'place', 'Playgrounds',                 32, 'everyday'),
  ('p_vineyards_wineries',   'place', 'Vineyards & Wineries',        33, 'everyday')
on conflict (id) do nothing;

-- The matcher: same deterministic shape (stemmed-lexeme overlap >= 2 words,
-- 90-day window, open posts only), widened to the travel area and taught to
-- read a travel post's structured facts as part of its text.
create or replace function public.match_marketplace_post()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $func$
declare
  v_mode text;
  v_words text[];
  r record;
begin
  if not (new.service_areas && array['marketplace', 'travel']) or not new.is_public then
    return new;
  end if;
  v_mode := coalesce(new.details->>'mode', '');
  v_words := tsvector_to_array(
    to_tsvector('english',
      coalesce(new.title, '') || ' ' || coalesce(new.body, '') || ' ' ||
      coalesce(new.details->>'routeFrom', '') || ' ' ||
      coalesce(new.details->>'routeTo', '') || ' ' ||
      coalesce(new.details->>'vehicle', '') || ' ' ||
      coalesce(new.details->>'travelKind', '')));
  if coalesce(array_length(v_words, 1), 0) < 2 then return new; end if;

  if v_mode = 'iso' then
    for r in
      select p.author_id, p.details->>'mode' as mode
        from posts p
       where p.service_areas && array['marketplace', 'travel']
         and p.is_public
         and coalesce(p.details->>'mode', '') not in ('', 'iso')
         and p.author_id <> new.author_id
         and p.created_at > now() - interval '90 days'
         and not exists (select 1 from public.exchanges x
                          where x.post_id = p.id and x.status in ('accepted', 'completed'))
         and (select count(*)
                from unnest(tsvector_to_array(
                       to_tsvector('english',
                         coalesce(p.title, '') || ' ' || coalesce(p.body, '') || ' ' ||
                         coalesce(p.details->>'routeFrom', '') || ' ' ||
                         coalesce(p.details->>'routeTo', '') || ' ' ||
                         coalesce(p.details->>'vehicle', '') || ' ' ||
                         coalesce(p.details->>'travelKind', '')))) w
               where w = any(v_words)) >= 2
       order by p.created_at desc
       limit 5
    loop
      perform public.notify(r.author_id, 'home', null, 'iso_match',
        'Someone is in search of what you''re offering',
        left(coalesce(nullif(new.title, ''), new.body), 140),
        '/posts/' || new.id, new.author_id);
    end loop;
  elsif v_mode <> '' then
    for r in
      select p.author_id
        from posts p
       where p.service_areas && array['marketplace', 'travel']
         and p.is_public
         and p.details->>'mode' = 'iso'
         and p.author_id <> new.author_id
         and p.created_at > now() - interval '90 days'
         and not exists (select 1 from public.exchanges x
                          where x.post_id = p.id and x.status in ('accepted', 'completed'))
         and (select count(*)
                from unnest(tsvector_to_array(
                       to_tsvector('english',
                         coalesce(p.title, '') || ' ' || coalesce(p.body, '') || ' ' ||
                         coalesce(p.details->>'routeFrom', '') || ' ' ||
                         coalesce(p.details->>'routeTo', '') || ' ' ||
                         coalesce(p.details->>'vehicle', '') || ' ' ||
                         coalesce(p.details->>'travelKind', '')))) w
               where w = any(v_words)) >= 2
       order by p.created_at desc
       limit 5
    loop
      perform public.notify(r.author_id, 'home', null, 'iso_match',
        case when v_mode = 'gift' then 'A gift matches what you''re seeking'
             else 'An offer matches what you''re seeking' end,
        left(coalesce(nullif(new.title, ''), new.body), 140),
        '/posts/' || new.id, new.author_id);
    end loop;
  end if;
  return new;
end $func$;
