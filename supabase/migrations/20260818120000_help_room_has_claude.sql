-- EVERY HELP ROOM HOLDS THE ASSISTANT (founder 2026-08-18: "Lichen Help is me
-- and the blue brain icon — update the UI to reflect that for all other
-- conversations"). The 2026-08-16 change put Claude in the founder's own help
-- room; ensure_help_chat never learned the move, so every other member's help
-- room was still just them + Lichen Health — one face in the inbox where the
-- founder's showed two. Same room, same two responders, for everyone.

-- Existing rooms: add the assistant wherever it's missing.
insert into public.chat_members (chat_id, profile_id)
select c.id, '85c04e7a-5a47-4c0e-85a4-0b35ff67a682'
  from public.chats c
 where c.kind = 'help'
   and not exists (select 1 from public.chat_members m
                    where m.chat_id = c.id and m.profile_id = '85c04e7a-5a47-4c0e-85a4-0b35ff67a682')
on conflict do nothing;

-- New rooms: the assistant is there from the first message. It also re-adds
-- it to an old room on the next visit, so nothing depends on the backfill.
create or replace function public.ensure_help_chat()
returns uuid language plpgsql security definer set search_path to 'public' as $func$
declare
  v_me      uuid := auth.uid();
  v_support uuid;
  v_claude  uuid := '85c04e7a-5a47-4c0e-85a4-0b35ff67a682';
  v_key     text;
  v_chat    uuid;
begin
  if v_me is null then raise exception 'Not signed in'; end if;
  select id into v_support from public.profiles where lower(email) = 'connect@lichen.health' limit 1;
  if v_support is null then raise exception 'Help is not available yet'; end if;
  if v_support = v_me then raise exception 'This is the help account'; end if;
  v_key := 'help:' || v_me::text;
  select id into v_chat from public.chats where direct_key = v_key;
  if v_chat is null then
    insert into public.chats (kind, direct_key, title) values ('help', v_key, null)
    on conflict (direct_key) where direct_key is not null do nothing
    returning id into v_chat;
    if v_chat is null then select id into v_chat from public.chats where direct_key = v_key; end if;
  end if;
  insert into public.chat_members (chat_id, profile_id) values (v_chat, v_me)      on conflict do nothing;
  insert into public.chat_members (chat_id, profile_id) values (v_chat, v_support) on conflict do nothing;
  insert into public.chat_members (chat_id, profile_id) values (v_chat, v_claude)  on conflict do nothing;
  return v_chat;
end; $func$;
