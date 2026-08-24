-- Notifications follow the hat (founder 2026-08-24: swapping to a space left
-- the person's calendar badge on the nav — "make notifications smart and your
-- profile shifts when you swap profiles"). The nav badges swap client-side by
-- filtering on notifications.space_id; the data gap was chat: a message bell
-- for a space's own conversation (space_dm / suggestion) carried no space, so
-- an admin acting AS the space had nothing to count. Stamp party_space_id on
-- those bells. As yourself the same row still counts in your Chat badge —
-- it is genuinely addressed to you, just worn "via the space".
create or replace function public.on_message_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $func$
declare v_kind text; v_name text; v_space text; v_party uuid;
begin
  select c.kind, s.name, c.party_space_id into v_kind, v_space, v_party
    from public.chats c left join public.spaces s on s.id = c.party_space_id
   where c.id = new.chat_id;
  if v_kind not in ('direct', 'care_team', 'help', 'space_dm', 'suggestion') then return new; end if;
  select coalesce(nullif(full_name, ''), email, 'A member')
    into v_name from public.profiles where id = new.sender_id;
  insert into public.notifications (recipient_id, section, space_id, type, title, body, link, actor_id)
  select m.profile_id, 'chat', v_party, 'dm_message',
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
