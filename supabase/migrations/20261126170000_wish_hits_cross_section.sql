-- ALL BRAINS WORK AS ONE (founder 2026-11-26: "marketplace pings events when
-- there's a garage sale with pics of items that your marketplace brain knows
-- you want to buy"). A wish hit can now come from an EVENT (a garage sale, a
-- market) as well as a listing: it files into the market thread (the old
-- 'marketplace' thread id never existed, so hits never showed in the
-- Marketplace brain), wears every section it touches, and its door says
-- what it opens.
drop function if exists public._assistant_wish_hit(uuid, text, text, text, text);
create or replace function public._assistant_wish_hit(
  p_watch uuid, p_title text, p_body text, p_link text, p_about text,
  p_sections text[] default '{market}', p_door text default 'See the listing')
returns uuid
language plpgsql security definer set search_path to 'public' as $function$
declare w assistant_watches; v_convo uuid;
begin
  select * into w from assistant_watches where id = p_watch and kind = 'wish' and status = 'active' for update;
  if w.id is null then return null; end if;
  v_convo := coalesce(w.convo_id, gen_random_uuid());
  insert into assistant_feed_posts (profile_id, author, body, thread, convo_id, sections, attachments)
  values (w.profile_id, 'claude', left(p_body, 4000), 'market', v_convo,
    (select array_agg(distinct s) from unnest(coalesce(p_sections, '{}')) s where s <> 'market'),
    jsonb_build_array(jsonb_build_object('type', 'app_link', 'path', p_link, 'label', left(coalesce(p_door, 'See the listing'), 60)),
                      jsonb_build_object('type', 'ping_feedback', 'about', left(p_about, 300), 'wish', w.label)));
  insert into assistant_convo_names (profile_id, convo_id, title)
  values (w.profile_id, v_convo, left('Wish list: ' || w.label, 120))
  on conflict (profile_id, convo_id) do nothing;
  update assistant_watches set convo_id = v_convo, hits = hits + 1 where id = p_watch;
  perform notify(w.profile_id, 'home', null, 'assistant_watch', left(p_title, 200), null, p_link, null);
  return v_convo;
end $function$;
revoke all on function public._assistant_wish_hit(uuid, text, text, text, text, text[], text) from public, anon, authenticated;

-- earlier hits filed under the phantom thread move into Marketplace's
update public.assistant_feed_posts set thread = 'market' where thread = 'marketplace';
