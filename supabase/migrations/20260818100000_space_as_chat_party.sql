-- A SPACE CAN BE A PARTY TO A CHAT (founder 2026-08-17/18): "a Space,
-- Organization, Community or Group should be able to be a chat member … they
-- display both the Space logo and which admin is answering you regarding
-- that post. Always have the [admin] who created the post be the one who
-- gets the chat from feed. If it's a general chat to the Place, any [admin]
-- can reply."
--
-- Shape: a new chat kind, 'space_dm'. The space is the PARTY (party_space_id
-- — its own column, deliberately NOT chats.space_id, which means "this is the
-- space's own room" and drives the member-sync trigger; reusing it would have
-- synced the whole membership into every DM). The people in the chat are the
-- visitor plus the humans who answer FOR the space:
--   · from a post   → the admin who wrote it (one responder; key carries them)
--   · general       → all current admins (any of them may reply)
-- The visitor's face and the space's logo are what the two sides see; each
-- admin's message carries their own name, so it's always clear WHO answered.
--
-- One conversation per (visitor, space, responder-set), keyed like direct
-- DMs, so writing about two posts by the same steward lands in one thread
-- (each arriving with its own pinned post), and the general thread is its
-- own. Offline gate: an offline space's DMs hide too (is_chat_member).

alter table public.chats drop constraint if exists chats_kind_check;
alter table public.chats add constraint chats_kind_check
  check (kind = any (array['organization','community','group','place','care_team','direct','event','help','space_dm']));

alter table public.chats
  add column if not exists party_space_id uuid references public.spaces(id) on delete cascade;
create index if not exists chats_party_space_idx on public.chats (party_space_id) where party_space_id is not null;

-- The one choke point learns the second column.
create or replace function public.is_chat_member(p_chat uuid, p_uid uuid)
returns boolean language sql stable security definer set search_path to 'public' as $func$
  select exists (select 1 from public.chat_members m where m.chat_id = p_chat and m.profile_id = p_uid)
     and not exists (select 1 from public.chats c
                      where c.id = p_chat
                        and ((c.space_id is not null and not public.space_alive(c.space_id))
                          or (c.party_space_id is not null and not public.space_alive(c.party_space_id))));
$func$;

-- Bells: a space DM bells like a DM, and names the space.
create or replace function public.on_message_notify()
returns trigger language plpgsql security definer set search_path to 'public' as $func$
declare v_kind text; v_name text; v_space text;
begin
  select c.kind, s.name into v_kind, v_space
    from public.chats c left join public.spaces s on s.id = c.party_space_id
   where c.id = new.chat_id;
  if v_kind not in ('direct', 'care_team', 'help', 'space_dm') then return new; end if;
  select coalesce(nullif(full_name, ''), email, 'A member')
    into v_name from public.profiles where id = new.sender_id;
  insert into public.notifications (recipient_id, section, type, title, body, link, actor_id)
  select m.profile_id, 'chat', 'dm_message',
         case when v_kind = 'space_dm' and v_space is not null then v_name || ' · ' || v_space else v_name end,
         left(coalesce(new.body, 'Sent an attachment'), 140),
         '/chat/' || new.chat_id, new.sender_id
  from public.chat_members m
  where m.chat_id = new.chat_id and m.profile_id <> new.sender_id;
  return new;
end; $func$;

-- Find-or-create the conversation between me and a space.
--   p_responder: the admin who should answer (the post's author) — must be a
--   current admin of the space, else the general thread is used instead.
create or replace function public.ensure_space_chat(p_space uuid, p_responder uuid default null)
returns uuid language plpgsql security definer set search_path to 'public' as $func$
declare
  v_me uuid := auth.uid();
  v_key text;
  v_chat uuid;
  v_resp uuid := null;
begin
  if v_me is null then raise exception 'Not signed in'; end if;
  if not public.space_alive(p_space) then raise exception 'That space isn''t reachable right now.'; end if;
  if public.is_space_admin(p_space, v_me) then
    raise exception 'You steward this space — its conversations are in your inbox.';
  end if;
  if p_responder is not null and p_responder <> v_me
     and public.is_space_admin(p_space, p_responder) then
    v_resp := p_responder;
  end if;
  v_key := 'space:' || p_space::text || ':' || v_me::text || coalesce(':' || v_resp::text, '');
  select id into v_chat from public.chats where direct_key = v_key;
  if v_chat is null then
    insert into public.chats (kind, party_space_id, direct_key, title)
    values ('space_dm', p_space, v_key, null)
    on conflict (direct_key) where direct_key is not null do nothing
    returning id into v_chat;
    if v_chat is null then select id into v_chat from public.chats where direct_key = v_key; end if;
  end if;
  insert into public.chat_members (chat_id, profile_id) values (v_chat, v_me) on conflict do nothing;
  if v_resp is not null then
    insert into public.chat_members (chat_id, profile_id) values (v_chat, v_resp) on conflict do nothing;
  else
    -- General thread: every current admin sits in it (re-run adds any new
    -- admin the next time the visitor opens the door).
    insert into public.chat_members (chat_id, profile_id)
    select v_chat, m.profile_id from public.space_members m
     where m.space_id = p_space and m.role in ('admin', 'super_admin')
    on conflict do nothing;
  end if;
  return v_chat;
end;
$func$;
revoke all on function public.ensure_space_chat(uuid, uuid) from public;
grant execute on function public.ensure_space_chat(uuid, uuid) to authenticated;
