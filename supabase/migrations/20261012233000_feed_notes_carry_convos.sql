-- EVERY PROACTIVE FEED NOTE IS A CONVERSATION (founder 2026-10-12: clicking
-- the dev-report "it's fixed" row in her Current-cy list opened an EMPTY
-- pane — the trigger's feed branch inserted with NO convo_id, so the list
-- showed a row whose entries the conversation view couldn't find; and "so i
-- can continue it, right?" — yes: a convo id is what the reply rides).
-- _currentcy_claude_note already mints one; this brings the dev-report
-- announcement in line and backfills the stranded rows.

create or replace function public.on_dev_report_fixed()
returns trigger
language plpgsql security definer set search_path = public
as $func$
declare
  v_claude uuid := '85c04e7a-5a47-4c0e-85a4-0b35ff67a682';
  v_chat uuid;
  v_body text;
begin
  if new.status <> 'fixed' or old.status = 'fixed' then return new; end if;
  if new.autonomous then
    v_body := 'Good news — the issue reported here ("' || new.summary || '") should be fixed now. I''m running these fixes on my own; if something looks funny or isn''t working, say so here and we can bring Galyn into the conversation. 🌱';
  else
    v_body := 'Good news — the issue reported here ("' || new.summary || '") has been fixed by the builders. Thank you for flagging it; reports like this are how the platform gets better. 🌱';
  end if;
  if new.via like 'chat:%' then
    begin
      v_chat := nullif(split_part(new.via, ':', 3), '')::uuid;
    exception when others then
      v_chat := null;
    end;
    if v_chat is not null
       and exists (select 1 from public.chat_members m where m.chat_id = v_chat and m.profile_id = v_claude) then
      insert into public.chat_messages (chat_id, sender_id, body) values (v_chat, v_claude, v_body);
    end if;
  elsif new.via like 'feed:%' then
    -- A fresh conversation of its own (the email grammar): the member can
    -- open it AND continue it — their reply rides the same convo_id.
    insert into public.assistant_feed_posts (profile_id, author, thread, body, convo_id)
    values (new.reporter_id, 'claude', substring(new.via from 6), v_body, gen_random_uuid());
  end if;
  return new;
end $func$;

-- Backfill the stranded rows (one exists today): each becomes its own
-- conversation, so the list row and the open pane finally agree.
update public.assistant_feed_posts
set convo_id = gen_random_uuid()
where convo_id is null and thread not like 'space:%';
