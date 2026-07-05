-- =============================================================================
-- Event chat — a room per event: the host + everyone who's going.
--
-- NOT auto-applied. Run in the Supabase SQL editor, then refresh the init.sql
-- baseline with pg_dump. Idempotent.
--
-- Membership follows RSVP: going → in the room; cancel/decline → out (the
-- host always stays). The room is created lazily (first open / first RSVP)
-- via ensure_event_chat(), mirroring ensure_care_chat(). Event rooms live on
-- the event page's Chat tab, not the Chat inbox (like care-team rooms).
-- All existing chat machinery (RLS via is_chat_member, realtime, media,
-- reactions, replies, DM notifications-excluded kinds) applies unchanged.
-- =============================================================================

-- ── chats: new kind + event link ──────────────────────────────────────────────
alter table public.chats drop constraint if exists chats_kind_check;
alter table public.chats add constraint chats_kind_check check (
  kind = any (array['organization','community','group','place','care_team','direct','event']::text[])
);
alter table public.chats add column if not exists event_id uuid references public.events(id) on delete cascade;
create unique index if not exists chats_event_uniq on public.chats (event_id) where kind = 'event';

-- ── ensure_event_chat: find-or-create, guarded ────────────────────────────────
create or replace function public.ensure_event_chat(p_event uuid)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_chat uuid; v_creator uuid; v_title text; v_uid uuid := auth.uid();
begin
  select creator_id, title into v_creator, v_title from public.events where id = p_event;
  if v_creator is null then raise exception 'event not found'; end if;
  -- Only the host or someone going may open (and thereby create) the room.
  if v_uid <> v_creator and not exists (
    select 1 from public.event_attendees a
    where a.event_id = p_event and a.profile_id = v_uid and a.status = 'going'
  ) then
    raise exception 'not a member of this event';
  end if;

  select id into v_chat from public.chats where event_id = p_event and kind = 'event';
  if v_chat is null then
    insert into public.chats (kind, event_id, title)
    values ('event', p_event, coalesce(v_title, 'Event chat'))
    returning id into v_chat;
  end if;
  -- Host is always in; the opener joins if they're going (guard above).
  insert into public.chat_members (chat_id, profile_id) values (v_chat, v_creator) on conflict do nothing;
  insert into public.chat_members (chat_id, profile_id) values (v_chat, v_uid) on conflict do nothing;
  return v_chat;
end; $$;
alter function public.ensure_event_chat(uuid) owner to postgres;
revoke all on function public.ensure_event_chat(uuid) from public, anon;
grant execute on function public.ensure_event_chat(uuid) to authenticated;

-- ── Membership follows RSVP ───────────────────────────────────────────────────
create or replace function public.sync_attendee_to_event_chat()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_chat uuid; v_creator uuid;
declare v_event uuid; v_profile uuid; v_status text;
begin
  if tg_op = 'DELETE' then
    v_event := old.event_id; v_profile := old.profile_id; v_status := 'declined';
  else
    v_event := new.event_id; v_profile := new.profile_id; v_status := new.status;
  end if;

  select id into v_chat from public.chats where event_id = v_event and kind = 'event';
  select creator_id into v_creator from public.events where id = v_event;

  if v_status = 'going' then
    -- Join (create the room on first RSVP so the tab is alive for everyone).
    if v_chat is null then
      insert into public.chats (kind, event_id, title)
      select 'event', e.id, coalesce(e.title, 'Event chat') from public.events e where e.id = v_event
      returning id into v_chat;
      insert into public.chat_members (chat_id, profile_id) values (v_chat, v_creator) on conflict do nothing;
    end if;
    insert into public.chat_members (chat_id, profile_id) values (v_chat, v_profile) on conflict do nothing;
  elsif v_chat is not null and v_profile <> v_creator then
    -- Cancelled / declined / removed → out of the room (host stays).
    delete from public.chat_members where chat_id = v_chat and profile_id = v_profile;
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end; $$;
alter function public.sync_attendee_to_event_chat() owner to postgres;
drop trigger if exists sync_attendee_event_chat_trg on public.event_attendees;
create trigger sync_attendee_event_chat_trg
  after insert or update or delete on public.event_attendees
  for each row execute function public.sync_attendee_to_event_chat();
