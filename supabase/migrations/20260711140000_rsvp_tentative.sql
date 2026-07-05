-- =============================================================================
-- RSVP "Maybe" — event_attendees.status gains 'tentative'.
--
-- NOT auto-applied. Run in the Supabase SQL editor. Idempotent.
-- Run AFTER the event-chat migration (it replaces those two functions with
-- tentative-aware versions).
--
-- Product decision (2026-07-05): maybes DO join the event chat room — asking
-- questions is what turns a maybe into a yes. Declining / cancelling still
-- removes you (host always stays). Tentative counts as busy in free_busy
-- (status <> 'declined'), same as an unanswered invite.
-- =============================================================================

-- ── status CHECK gains 'tentative' ───────────────────────────────────────────
alter table public.event_attendees drop constraint if exists event_attendees_status_check;
alter table public.event_attendees add constraint event_attendees_status_check check (
  status = any (array['invited'::text, 'going'::text, 'declined'::text, 'tentative'::text])
);

-- ── ensure_event_chat: maybes may open the room too ──────────────────────────
create or replace function public.ensure_event_chat(p_event uuid)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_chat uuid; v_creator uuid; v_title text; v_uid uuid := auth.uid();
begin
  select creator_id, title into v_creator, v_title from public.events where id = p_event;
  if v_creator is null then raise exception 'event not found'; end if;
  if v_uid <> v_creator and not exists (
    select 1 from public.event_attendees a
    where a.event_id = p_event and a.profile_id = v_uid
      and a.status in ('going', 'tentative')
  ) then
    raise exception 'not a member of this event';
  end if;

  select id into v_chat from public.chats where event_id = p_event and kind = 'event';
  if v_chat is null then
    insert into public.chats (kind, event_id, title)
    values ('event', p_event, coalesce(v_title, 'Event chat'))
    returning id into v_chat;
  end if;
  insert into public.chat_members (chat_id, profile_id) values (v_chat, v_creator) on conflict do nothing;
  insert into public.chat_members (chat_id, profile_id) values (v_chat, v_uid) on conflict do nothing;
  return v_chat;
end; $$;
alter function public.ensure_event_chat(uuid) owner to postgres;
revoke all on function public.ensure_event_chat(uuid) from public, anon;
grant execute on function public.ensure_event_chat(uuid) to authenticated;

-- ── membership sync: going OR tentative → in the room ────────────────────────
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

  if v_status in ('going', 'tentative') then
    if v_chat is null then
      insert into public.chats (kind, event_id, title)
      select 'event', e.id, coalesce(e.title, 'Event chat') from public.events e where e.id = v_event
      returning id into v_chat;
      insert into public.chat_members (chat_id, profile_id) values (v_chat, v_creator) on conflict do nothing;
    end if;
    insert into public.chat_members (chat_id, profile_id) values (v_chat, v_profile) on conflict do nothing;
  elsif v_chat is not null and v_profile <> v_creator then
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

-- ── host notification: a maybe reads "might come", not "can't make it" ───────
create or replace function public.on_event_rsvp_notify()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_name text; v_title text; v_creator uuid;
begin
  if new.status = old.status or new.status = 'invited' then return new; end if;
  select coalesce(nullif(full_name, ''), email, 'A member')
    into v_name from public.profiles where id = new.profile_id;
  select title, creator_id into v_title, v_creator from public.events where id = new.event_id;
  perform public.notify(v_creator, 'calendar', null, 'event_rsvp',
    v_name,
    (case new.status
       when 'going' then 'is going: '
       when 'tentative' then 'might come: '
       else 'can''t make it: '
     end) || coalesce(v_title, 'your event'),
    '/calendar', new.profile_id);
  return new;
end; $$;
alter function public.on_event_rsvp_notify() owner to postgres;
drop trigger if exists on_event_rsvp_notify_trg on public.event_attendees;
create trigger on_event_rsvp_notify_trg after update on public.event_attendees
  for each row execute function public.on_event_rsvp_notify();
