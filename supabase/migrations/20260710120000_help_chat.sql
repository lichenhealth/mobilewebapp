-- =============================================================================
-- Help chat — any member can open a support room with the Lichen help account.
--
-- NOT auto-applied. Run in the Supabase SQL editor. Idempotent.
-- ⚠ RUN AFTER 20260709120000_event_chat.sql — both migrations rebuild
--   chats_kind_check, and this one's list already includes 'event'. Running
--   this one FIRST and the event one SECOND would drop 'help' again.
--
-- The support account is the profile whose email is connect@lichen.health
-- (Lichen's Workspace address). Every member gets at most ONE help room
-- (deduped via direct_key = 'help:<member id>' on the existing unique index).
-- All chat RLS already keys off is_chat_member(), so only the member and the
-- support account can ever read a help room — no policy changes needed.
-- =============================================================================

-- ── chats.kind gains 'help' ──────────────────────────────────────────────────
alter table public.chats drop constraint if exists chats_kind_check;
alter table public.chats add constraint chats_kind_check check (
  kind = any (array[
    'organization'::text, 'community'::text, 'group'::text, 'place'::text,
    'care_team'::text, 'direct'::text, 'event'::text, 'help'::text
  ])
);

-- ── The support account is a platform admin ─────────────────────────────────
update public.profiles set is_admin = true
where lower(email) = 'connect@lichen.health';

-- ── Find-or-create my help room ──────────────────────────────────────────────
create or replace function public.ensure_help_chat()
returns uuid
language plpgsql security definer set search_path to 'public' as $$
declare
  v_me      uuid := auth.uid();
  v_support uuid;
  v_key     text;
  v_chat    uuid;
begin
  if v_me is null then raise exception 'Not signed in'; end if;

  select id into v_support from public.profiles
  where lower(email) = 'connect@lichen.health' limit 1;
  if v_support is null then raise exception 'Help is not available yet'; end if;
  if v_support = v_me then raise exception 'This is the help account'; end if;

  v_key := 'help:' || v_me::text;

  select id into v_chat from public.chats where direct_key = v_key;
  if v_chat is null then
    insert into public.chats (kind, direct_key, title)
    values ('help', v_key, null)
    on conflict (direct_key) where direct_key is not null do nothing
    returning id into v_chat;

    if v_chat is null then
      select id into v_chat from public.chats where direct_key = v_key;
    end if;

    insert into public.chat_members (chat_id, profile_id) values (v_chat, v_me)      on conflict do nothing;
    insert into public.chat_members (chat_id, profile_id) values (v_chat, v_support) on conflict do nothing;
  end if;

  return v_chat;
end; $$;
alter function public.ensure_help_chat() owner to postgres;
grant execute on function public.ensure_help_chat() to authenticated;

-- ── Bell notifications for help messages ─────────────────────────────────────
-- (Same producer as DMs/care-team; help rooms are person-to-person, so per-
-- message bells are right — big rooms like spaces/events stay bell-free.)
create or replace function public.on_message_notify()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_kind text; v_name text;
begin
  select kind into v_kind from public.chats where id = new.chat_id;
  if v_kind not in ('direct', 'care_team', 'help') then return new; end if;
  select coalesce(nullif(full_name, ''), email, 'A member')
    into v_name from public.profiles where id = new.sender_id;
  insert into public.notifications (recipient_id, section, type, title, body, link, actor_id)
  select m.profile_id, 'chat', 'dm_message',
         v_name, left(coalesce(new.body, 'Sent an attachment'), 140),
         '/chat/' || new.chat_id, new.sender_id
  from public.chat_members m
  where m.chat_id = new.chat_id and m.profile_id <> new.sender_id;
  return new;
end; $$;
alter function public.on_message_notify() owner to postgres;
