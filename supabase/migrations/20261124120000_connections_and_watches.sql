-- CONNECTIONS + STANDING WATCHES (founder 2026-11-24: "how can we make this
-- more seamless and easy for non technical lichen users and their other
-- services, like their bank and twilio" → "sure").
--
-- 1. service_connections — a member's own link to an outside service whose
--    only door is a key (Twilio first). The member pastes the key into a
--    Lichen form once; it is checked against the service and stored locked
--    to their account. Members never touch Supabase secrets — those are
--    Lichen's own accounts only.
-- 2. service_secrets — the keys themselves. RLS on, NO policies, nothing
--    granted (the mail_tokens posture): only Lichen's servers read them, and
--    only to act for that member.
-- 3. assistant_watches — "when X happens, tell me (and here's what I'll
--    want done)". The brain sets them from the member's words; a tick checks
--    every 10 minutes and, when one comes true, the brain writes a note and
--    rings a bell. A watch only ever reads the member's OWN mail / own
--    connected service.

create table if not exists public.service_connections (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  service text not null check (service in ('twilio')),
  label text check (length(coalesce(label, '')) <= 200),
  status text not null default 'connected' check (status in ('connected', 'error')),
  last_error text check (length(coalesce(last_error, '')) <= 500),
  connected_at timestamptz not null default now(),
  unique (profile_id, service)
);
alter table public.service_connections enable row level security;
drop policy if exists "service_connections own read" on public.service_connections;
create policy "service_connections own read" on public.service_connections
  for select to authenticated using (profile_id = auth.uid());
revoke all on public.service_connections from anon;

create table if not exists public.service_secrets (
  connection_id uuid primary key references public.service_connections(id) on delete cascade,
  secret jsonb not null
);
alter table public.service_secrets enable row level security;
revoke all on public.service_secrets from anon, authenticated;

create table if not exists public.assistant_watches (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('mail', 'twilio_number')),
  label text not null check (length(btrim(label)) between 2 and 200),
  query text not null check (length(btrim(query)) between 2 and 500),
  then_note text check (length(coalesce(then_note, '')) <= 1000),
  status text not null default 'active' check (status in ('active', 'fired', 'cancelled', 'expired')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 days',
  last_checked_at timestamptz,
  fired_at timestamptz,
  fired_detail text check (length(coalesce(fired_detail, '')) <= 500),
  convo_id uuid
);
create index if not exists assistant_watches_active_idx on public.assistant_watches (status, expires_at);
alter table public.assistant_watches enable row level security;
drop policy if exists "assistant_watches own read" on public.assistant_watches;
create policy "assistant_watches own read" on public.assistant_watches
  for select to authenticated using (profile_id = auth.uid());
-- Stopping a watch is the member's own act (the brain's my_watches cancels
-- through the service role). Only an active watch can be stopped.
drop policy if exists "assistant_watches own stop" on public.assistant_watches;
create policy "assistant_watches own stop" on public.assistant_watches
  for update to authenticated using (profile_id = auth.uid() and status = 'active')
  with check (profile_id = auth.uid() and status = 'cancelled');
revoke all on public.assistant_watches from anon;

-- A watch came true: the brain's note in the member's general thread (its
-- own named conversation), a bell, and the watch closes. One door, so the
-- edge function can't half-fire.
create or replace function public._assistant_watch_fire(p_watch uuid, p_detail text, p_body text)
returns uuid language plpgsql security definer set search_path = public as $func$
declare w assistant_watches; v_convo uuid;
begin
  select * into w from assistant_watches where id = p_watch for update;
  if w.id is null or w.status <> 'active' then return null; end if;
  v_convo := gen_random_uuid();
  insert into assistant_feed_posts (profile_id, author, body, thread, convo_id)
  values (w.profile_id, 'claude', p_body, 'general', v_convo);
  insert into assistant_convo_names (profile_id, convo_id, title)
  values (w.profile_id, v_convo, left('Watch: ' || w.label, 120))
  on conflict (profile_id, convo_id) do nothing;
  update assistant_watches set status = 'fired', fired_at = now(), fired_detail = left(p_detail, 500),
    convo_id = v_convo, last_checked_at = now() where id = p_watch;
  perform notify(w.profile_id, 'home', null, 'assistant_watch',
    left('It happened: ' || w.label, 200), left(coalesce(p_detail, ''), 300),
    '/assistant/feed?thread=general&convo=' || v_convo, null);
  return v_convo;
end $func$;
revoke all on function public._assistant_watch_fire(uuid, text, text) from public, anon, authenticated;

create or replace function public.tick_assistant_watches()
returns void language plpgsql security definer set search_path = public as $func$
declare v_secret text;
begin
  update assistant_watches set status = 'expired' where status = 'active' and expires_at < now();
  if not exists (select 1 from assistant_watches where status = 'active') then return; end if;
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'push_hook_secret';
  begin
    perform net.http_post(
      url := 'https://mjqnaevertyzgjlpwynr.supabase.co/functions/v1/assistant-watch',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', coalesce(v_secret, '')),
      body := '{}'::jsonb);
  exception when others then null;
  end;
end $func$;
revoke all on function public.tick_assistant_watches() from public, anon, authenticated;

select cron.unschedule('tick-assistant-watches') where exists (select 1 from cron.job where jobname = 'tick-assistant-watches');
select cron.schedule('tick-assistant-watches', '*/10 * * * *', $c$select public.tick_assistant_watches()$c$);
