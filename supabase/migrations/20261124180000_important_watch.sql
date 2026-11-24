-- THE IMPORTANT-MAIL WATCH (founder 2026-11-24: "a pop up notification on my
-- phone from lichen monitoring connected apps" → "that works, build what you
-- need to build"). A STANDING watch that never closes: each tick the Brain
-- reads the member's NEW inbox mail (sender, subject, preview only) and
-- decides which pieces truly need them; each one rings a bell (→ push) and
-- joins one running conversation, "Important mail". query = what matters to
-- them in their own words (optional).
alter table public.assistant_watches drop constraint if exists assistant_watches_kind_check;
alter table public.assistant_watches add constraint assistant_watches_kind_check
  check (kind in ('mail', 'twilio_number', 'important'));
create unique index if not exists assistant_watches_one_important
  on public.assistant_watches (profile_id) where kind = 'important' and status = 'active';
alter table public.assistant_watches add column if not exists hits int not null default 0;

-- One important piece came in: the Brain's line in the standing
-- conversation + a bell. The watch stays active.
create or replace function public._assistant_important_hit(p_watch uuid, p_title text, p_body text, p_link text)
returns uuid language plpgsql security definer set search_path = public as $func$
declare w assistant_watches; v_convo uuid;
begin
  select * into w from assistant_watches where id = p_watch and kind = 'important' and status = 'active' for update;
  if w.id is null then return null; end if;
  v_convo := coalesce(w.convo_id, gen_random_uuid());
  insert into assistant_feed_posts (profile_id, author, body, thread, convo_id, attachments)
  values (w.profile_id, 'claude', left(p_body, 4000), 'general', v_convo,
    case when coalesce(p_link, '') like '/%' then jsonb_build_array(jsonb_build_object('type', 'app_link', 'path', p_link, 'label', 'Open it')) else '[]'::jsonb end);
  insert into assistant_convo_names (profile_id, convo_id, title)
  values (w.profile_id, v_convo, 'Important mail')
  on conflict (profile_id, convo_id) do nothing;
  update assistant_watches set convo_id = v_convo, hits = hits + 1, last_checked_at = now() where id = p_watch;
  perform notify(w.profile_id, 'home', null, 'assistant_watch',
    left(p_title, 200), null,
    coalesce(nullif(p_link, ''), '/assistant/feed?thread=general&convo=' || v_convo), null);
  return v_convo;
end $func$;
revoke all on function public._assistant_important_hit(uuid, text, text, text) from public, anon, authenticated;

-- The manual switch (Profile → Connections): the member's own door to the
-- same row the Brain's watch_for writes. Needs a connected inbox.
create or replace function public.start_important_watch()
returns uuid language plpgsql security definer set search_path = public as $func$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if not exists (select 1 from mail_accounts where profile_id = auth.uid()) then
    raise exception 'Connect an inbox in Mail first — that is how Lichen hears from your apps.';
  end if;
  select id into v_id from assistant_watches where profile_id = auth.uid() and kind = 'important' and status = 'active';
  if v_id is not null then return v_id; end if;
  insert into assistant_watches (profile_id, kind, label, query, expires_at, last_checked_at)
  values (auth.uid(), 'important', 'Important mail', 'anything important', now() + interval '10 years', now())
  returning id into v_id;
  return v_id;
end $func$;
revoke all on function public.start_important_watch() from public, anon;
grant execute on function public.start_important_watch() to authenticated;
