-- TOPIC ROOMS + PER-ROOM AI CONSENT (founder 2026-10-21: "we'd need different
-- chat threads for different topics within the group or community… my
-- curandurismo training doesn't want Ai tracking any of our teachings/learnings,
-- but would be fine with Ai helping us plan food buying for a retreat weekend"
-- and, same sitting, "each chat thread … should have Ai enabled or not options").
--
-- A topic room is a SECOND chats row on the same space_id — same kind, same
-- synced membership, its own thread. The AI switch is per ROOM and universal:
-- chats.assistant_enabled=false means nothing said in that room reaches any
-- assistant (claude-chat skips it entirely; client assistant gathers filter it).
-- Enforcement ships before any richer UI — the 2026-08-17 consent doctrine.

alter table public.chats
  add column if not exists topic text,
  add column if not exists assistant_enabled boolean not null default true;

comment on column public.chats.topic is
  'Topic rooms (2026-10-21): null = the space''s main room. A named topic is another room of the same space — same synced membership, its own thread.';
comment on column public.chats.assistant_enabled is
  'Per-room AI consent (2026-10-21): false = nothing said in this room reaches any assistant. claude-chat skips the room; client assistant gathers filter it out.';

-- One room per topic per space (case-insensitive).
create unique index if not exists chats_topic_per_space
  on public.chats (space_id, lower(topic)) where topic is not null;

-- chats_space_uidx enforced ONE chat per space — the very rule topic rooms
-- retire. The uniqueness that still matters is one MAIN room per space.
drop index if exists public.chats_space_uidx;
create unique index if not exists chats_space_main_uidx
  on public.chats (space_id) where space_id is not null and topic is null;

-- The membership sync must reach EVERY room of the space now — the old body
-- did `select id into v_chat` (one row) and quietly ignored the rest.
create or replace function public.sync_member_to_chat()
returns trigger
language plpgsql security definer set search_path = public
as $func$
declare r record;
begin
  if (TG_OP = 'INSERT') then
    for r in select id from public.chats where space_id = new.space_id loop
      insert into public.chat_members (chat_id, profile_id) values (r.id, new.profile_id)
      on conflict do nothing;
    end loop;
    return new;
  elsif (TG_OP = 'DELETE') then
    for r in select id from public.chats where space_id = old.space_id loop
      delete from public.chat_members where chat_id = r.id and profile_id = old.profile_id;
    end loop;
    return old;
  end if;
  return null;
end;
$func$;

-- Admins add a topic room. The room is born with the whole current membership
-- (the sync trigger carries everyone after that) and may be born AI-free.
create or replace function public.create_space_topic_room(p_space uuid, p_topic text, p_ai boolean default true)
returns uuid
language plpgsql security definer set search_path = public
as $func$
declare
  v_me uuid := auth.uid();
  v_topic text := btrim(coalesce(p_topic, ''));
  v_kind text;
  v_chat uuid;
begin
  if v_me is null then raise exception 'Not signed in'; end if;
  if not public.space_alive(p_space) then raise exception 'That space isn''t reachable right now.'; end if;
  if not public.is_space_admin(p_space, v_me) then
    raise exception 'Only this space''s admins can add chat rooms.';
  end if;
  if v_topic = '' then raise exception 'Give the room a topic.'; end if;
  if length(v_topic) > 60 then raise exception 'Keep the topic under 60 characters.'; end if;
  select kind::text into v_kind from public.spaces where id = p_space;
  begin
    insert into public.chats (kind, space_id, title, topic, assistant_enabled)
    values (v_kind, p_space, v_topic, v_topic, coalesce(p_ai, true))
    returning id into v_chat;
  exception when unique_violation then
    raise exception 'A room called "%" already exists here.', v_topic;
  end;
  insert into public.chat_members (chat_id, profile_id)
  select v_chat, m.profile_id from public.space_members m where m.space_id = p_space
  on conflict do nothing;
  return v_chat;
end;
$func$;

-- Admins remove a topic room — never the main room, which IS the space's chat.
-- Messages and membership cascade with the row.
create or replace function public.delete_space_topic_room(p_chat uuid)
returns void
language plpgsql security definer set search_path = public
as $func$
declare
  v_space uuid;
  v_topic text;
begin
  select space_id, topic into v_space, v_topic from public.chats where id = p_chat;
  if not found or v_space is null then raise exception 'That isn''t a space chat room.'; end if;
  if v_topic is null then
    raise exception 'The main room can''t be deleted — it is the space''s own chat.';
  end if;
  if not public.is_space_admin(v_space, auth.uid()) then
    raise exception 'Only this space''s admins can remove chat rooms.';
  end if;
  delete from public.chats where id = p_chat;
end;
$func$;

-- Admins flip a room's AI switch (main room included — the space-wide
-- spaces.assistant_enabled stays the bigger switch above it).
create or replace function public.set_room_assistant_enabled(p_chat uuid, p_on boolean)
returns void
language plpgsql security definer set search_path = public
as $func$
declare v_space uuid;
begin
  select space_id into v_space from public.chats where id = p_chat;
  if v_space is null then raise exception 'That isn''t a space chat room.'; end if;
  if not public.is_space_admin(v_space, auth.uid()) then
    raise exception 'Only this space''s admins can change a room''s AI setting.';
  end if;
  update public.chats set assistant_enabled = coalesce(p_on, true) where id = p_chat;
end;
$func$;

revoke execute on function public.create_space_topic_room(uuid, text, boolean) from public, anon;
revoke execute on function public.delete_space_topic_room(uuid) from public, anon;
revoke execute on function public.set_room_assistant_enabled(uuid, boolean) from public, anon;
grant execute on function public.create_space_topic_room(uuid, text, boolean) to authenticated;
grant execute on function public.delete_space_topic_room(uuid) to authenticated;
grant execute on function public.set_room_assistant_enabled(uuid, boolean) to authenticated;
