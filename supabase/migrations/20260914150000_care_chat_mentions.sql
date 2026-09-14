-- Care rooms bell with intent (founder 2026-09-14: "care team members get
-- notified when they're tagged in the care team chat, but not every care
-- team chat entry — targeted notifications").
--
-- chat_messages.mentions carries WHO a message names (uuid[] of profile ids).
-- Today the only author of a mention is the WOW/KOC entry's "Ask" door —
-- the tag is structural (the entry's author), never typed — but the column
-- is general so a future @-composer plugs into the same bell rule.

alter table public.chat_messages
  add column if not exists mentions uuid[];

-- on_message_notify: unchanged for every other chat kind. For care_team:
-- the PATIENT hears everything in their own concierge room (it's their
-- care — and the answer to their tagged question must reach them); a
-- CAREGIVER hears only what names them, so a team of practitioners isn't
-- belled for every line of chatter but a targeted ask lands as a bell.
create or replace function public.on_message_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $func$
declare v_kind text; v_name text; v_space text; v_party uuid; v_patient uuid;
begin
  select c.kind, s.name, c.party_space_id, c.patient_id
    into v_kind, v_space, v_party, v_patient
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
  where m.chat_id = new.chat_id and m.profile_id <> new.sender_id
    and (v_kind <> 'care_team'
         or m.profile_id = v_patient
         or m.profile_id = any(coalesce(new.mentions, '{}')));
  return new;
end
$func$;

alter function public.on_message_notify() owner to postgres;
