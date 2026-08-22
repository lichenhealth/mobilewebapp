-- SUGGESTIONS CHAT (founder 2026-08-22): a member who isn't a steward can
-- suggest a change to a space's page, as a chat — "different than a help
-- chat, but similar". The room holds the suggester, the space's admins, and
-- Claude; it carries party_space_id, so acting as the space it appears in
-- the space's own inbox (the space_dm rail), and Claude being seated is what
-- makes the assistant answer there (assistant_on_message already fires for
-- any room Claude sits in). Admins can then work with Claude in the room to
-- make the change happen — claude-chat arms the space page tools for them.

-- 1. The new chat kind.
alter table public.chats drop constraint chats_kind_check;
alter table public.chats add constraint chats_kind_check
  check (kind = any (array['organization'::text, 'community'::text, 'group'::text,
    'place'::text, 'care_team'::text, 'direct'::text, 'event'::text, 'help'::text,
    'space_dm'::text, 'suggestion'::text]));

-- 2. The door. One suggestions room per member per space, reusable; reopening
--    seats any admin appointed since. Admins are refused — they edit
--    directly (ensure_space_chat's rule, same reason).
create or replace function public.ensure_suggestion_chat(p_space uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_me     uuid := auth.uid();
  v_claude uuid := '85c04e7a-5a47-4c0e-85a4-0b35ff67a682';
  v_key    text;
  v_chat   uuid;
begin
  if v_me is null then raise exception 'Not signed in'; end if;
  if not public.space_alive(p_space) then raise exception 'That space isn''t reachable right now.'; end if;
  if public.is_space_admin(p_space, v_me) then
    raise exception 'You steward this space — you can change its page directly.';
  end if;
  v_key := 'suggest:' || p_space::text || ':' || v_me::text;
  select id into v_chat from public.chats where direct_key = v_key;
  if v_chat is null then
    insert into public.chats (kind, party_space_id, direct_key, title)
    values ('suggestion', p_space, v_key, null)
    on conflict (direct_key) where direct_key is not null do nothing
    returning id into v_chat;
    if v_chat is null then select id into v_chat from public.chats where direct_key = v_key; end if;
  end if;
  insert into public.chat_members (chat_id, profile_id) values (v_chat, v_me) on conflict do nothing;
  insert into public.chat_members (chat_id, profile_id) values (v_chat, v_claude) on conflict do nothing;
  insert into public.chat_members (chat_id, profile_id)
  select v_chat, m.profile_id from public.space_members m
   where m.space_id = p_space and m.role in ('admin', 'super_admin')
  on conflict do nothing;
  return v_chat;
end
$func$;
grant execute on function public.ensure_suggestion_chat(uuid) to authenticated;

-- 3. Bells: a suggestion message notifies like a space_dm, titled with the
--    space so stewards see whose door it's about.
create or replace function public.on_message_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $func$
declare v_kind text; v_name text; v_space text;
begin
  select c.kind, s.name into v_kind, v_space
    from public.chats c left join public.spaces s on s.id = c.party_space_id
   where c.id = new.chat_id;
  if v_kind not in ('direct', 'care_team', 'help', 'space_dm', 'suggestion') then return new; end if;
  select coalesce(nullif(full_name, ''), email, 'A member')
    into v_name from public.profiles where id = new.sender_id;
  insert into public.notifications (recipient_id, section, type, title, body, link, actor_id)
  select m.profile_id, 'chat', 'dm_message',
         case when v_kind in ('space_dm', 'suggestion') and v_space is not null
              then v_name || ' · ' || v_space
              else v_name end,
         left(coalesce(new.body, 'Sent an attachment'), 140),
         '/chat/' || new.chat_id, new.sender_id
  from public.chat_members m
  where m.chat_id = new.chat_id and m.profile_id <> new.sender_id;
  return new;
end
$func$;
