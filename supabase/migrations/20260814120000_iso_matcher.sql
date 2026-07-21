-- THE MATCHER — stage 1 of needs-meet-offers (founder direction 2026-07-21:
-- "Elizabeth tells us what she needs… and what she has to offer").
-- Deterministic, no AI: a database trigger runs on every new PUBLIC
-- marketplace post.
--   * A new OFFER rings the bell of members whose open ISO ("in search of")
--     posts speak the same words — gift offers announce themselves as gifts,
--     and gifts outrank priced offers (the Lichen economy answers first).
--   * A new ISO rings the bell of members already offering a match
--     ("Someone is in search of what you're offering").
-- Matching = shared stemmed words (>= 2 lexemes, English stemming, stopwords
-- dropped) between the two posts' title+body. Public posts only — matching
-- must never leak private posts. 90-day freshness window, 5 bells per post.

create or replace function public.match_marketplace_post()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_mode text;
  v_words text[];
  r record;
begin
  if not (new.service_areas @> array['marketplace']) or not new.is_public then
    return new;
  end if;
  v_mode := coalesce(new.details->>'mode', '');
  v_words := tsvector_to_array(
    to_tsvector('english', coalesce(new.title, '') || ' ' || coalesce(new.body, '')));
  if coalesce(array_length(v_words, 1), 0) < 2 then return new; end if;

  if v_mode = 'iso' then
    -- New need: tell the people already offering.
    for r in
      select p.author_id, p.details->>'mode' as mode
        from posts p
       where p.service_areas @> array['marketplace']
         and p.is_public
         and coalesce(p.details->>'mode', '') not in ('', 'iso')
         and p.author_id <> new.author_id
         and p.created_at > now() - interval '90 days'
         and (select count(*)
                from unnest(tsvector_to_array(
                       to_tsvector('english', coalesce(p.title,'') || ' ' || coalesce(p.body,'')))) w
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
    -- New offer: tell the people already seeking. Gifts lead.
    for r in
      select p.author_id
        from posts p
       where p.service_areas @> array['marketplace']
         and p.is_public
         and p.details->>'mode' = 'iso'
         and p.author_id <> new.author_id
         and p.created_at > now() - interval '90 days'
         and (select count(*)
                from unnest(tsvector_to_array(
                       to_tsvector('english', coalesce(p.title,'') || ' ' || coalesce(p.body,'')))) w
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
end $$;

drop trigger if exists match_marketplace_post on public.posts;
create trigger match_marketplace_post
  after insert on public.posts
  for each row execute function public.match_marketplace_post();
