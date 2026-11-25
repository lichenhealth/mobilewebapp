-- THE BRAIN'S NOTEBOOK (founder 2026-11-25: "only notify based on what the
-- user tells the brain to notify them about… the brain should start to learn
-- what the user's entire life is like and begin to make assumptions about
-- whether they'd want to be notified… You know the movie her? I want the
-- brain to get that good!").
-- One row = one thing the brain knows about what matters to this member
-- (kind 'matters') or what they DON'T want to be pinged about (kind 'quiet').
-- Written when they tell it something (the brain's `remember` tool), when they
-- answer a ping's "glad you told me / don't ping me about this", or by hand.
-- It's theirs: they read all of it, add, and forget anything (Profile →
-- Connections). The brain reads it in every personal conversation and when it
-- decides whether to take a chance and ping them.
create table if not exists public.assistant_memory (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null default 'matters' check (kind in ('matters', 'quiet')),
  note text not null check (length(btrim(note)) between 2 and 400),
  source text not null default 'told' check (source in ('told', 'feedback', 'hand', 'watch')),
  created_at timestamptz not null default now()
);
create index if not exists assistant_memory_owner_idx on public.assistant_memory (profile_id, created_at desc);
alter table public.assistant_memory enable row level security;
drop policy if exists "assistant_memory own" on public.assistant_memory;
create policy "assistant_memory own" on public.assistant_memory
  for all to authenticated using (profile_id = auth.uid()) with check (profile_id = auth.uid());
revoke all on public.assistant_memory from anon;

-- The proactive watch renames: it isn't an inbox alarm, it's the brain
-- learning when to take a chance.
update public.assistant_watches set label = 'Taking a chance when it matters'
  where kind = 'important' and label = 'Important mail';

-- A ping carries its own teach-me buttons (glad you told me / don't ping me
-- about this kind of thing) — `about` names what it was about.
drop function if exists public._assistant_important_hit(uuid, text, text, text);
create or replace function public._assistant_important_hit(p_watch uuid, p_title text, p_body text, p_link text, p_about text default null)
returns uuid language plpgsql security definer set search_path = public as $func$
declare w assistant_watches; v_convo uuid; v_att jsonb := '[]'::jsonb;
begin
  select * into w from assistant_watches where id = p_watch and kind = 'important' and status = 'active' for update;
  if w.id is null then return null; end if;
  v_convo := coalesce(w.convo_id, gen_random_uuid());
  if coalesce(p_link, '') like '/%' then
    v_att := v_att || jsonb_build_array(jsonb_build_object('type', 'app_link', 'path', p_link, 'label', 'Open it'));
  end if;
  if coalesce(p_about, '') <> '' then
    v_att := v_att || jsonb_build_array(jsonb_build_object('type', 'ping_feedback', 'about', left(p_about, 300)));
  end if;
  insert into assistant_feed_posts (profile_id, author, body, thread, convo_id, attachments)
  values (w.profile_id, 'claude', left(p_body, 4000), 'general', v_convo, v_att);
  insert into assistant_convo_names (profile_id, convo_id, title)
  values (w.profile_id, v_convo, 'When I took a chance')
  on conflict (profile_id, convo_id) do nothing;
  update assistant_watches set convo_id = v_convo, hits = hits + 1, last_checked_at = now() where id = p_watch;
  perform notify(w.profile_id, 'home', null, 'assistant_watch',
    left(p_title, 200), null,
    coalesce(nullif(p_link, ''), '/assistant/feed?thread=general&convo=' || v_convo), null);
  return v_convo;
end $func$;
revoke all on function public._assistant_important_hit(uuid, text, text, text, text) from public, anon, authenticated;

-- WISHES (founder 2026-11-25, same sitting: "you have a wish list of items and
-- something is posted to marketplace that matches one of your items, or is
-- close, i'd want the brain to figure out the details and then notify you"):
-- watch kind 'wish' — query = the item in their words; standing (a year), never
-- closes on a match. Each tick reads NEW listings every member can see.
alter table public.assistant_watches drop constraint if exists assistant_watches_kind_check;
alter table public.assistant_watches add constraint assistant_watches_kind_check
  check (kind in ('mail', 'twilio_number', 'important', 'wish'));

create or replace function public._assistant_wish_hit(p_watch uuid, p_title text, p_body text, p_link text, p_about text)
returns uuid language plpgsql security definer set search_path = public as $func$
declare w assistant_watches; v_convo uuid;
begin
  select * into w from assistant_watches where id = p_watch and kind = 'wish' and status = 'active' for update;
  if w.id is null then return null; end if;
  v_convo := coalesce(w.convo_id, gen_random_uuid());
  insert into assistant_feed_posts (profile_id, author, body, thread, convo_id, attachments)
  values (w.profile_id, 'claude', left(p_body, 4000), 'marketplace', v_convo,
    jsonb_build_array(jsonb_build_object('type', 'app_link', 'path', p_link, 'label', 'See the listing'),
                      jsonb_build_object('type', 'ping_feedback', 'about', left(p_about, 300), 'wish', w.label)));
  insert into assistant_convo_names (profile_id, convo_id, title)
  values (w.profile_id, v_convo, left('Wish list: ' || w.label, 120))
  on conflict (profile_id, convo_id) do nothing;
  update assistant_watches set convo_id = v_convo, hits = hits + 1 where id = p_watch;
  perform notify(w.profile_id, 'home', null, 'assistant_watch', left(p_title, 200), null, p_link, null);
  return v_convo;
end $func$;
revoke all on function public._assistant_wish_hit(uuid, text, text, text, text) from public, anon, authenticated;
