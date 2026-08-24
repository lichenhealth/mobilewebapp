-- THE BRIDGE CLOSES ITS OWN LOOP (founder 2026-08-24: "you then can fix it
-- and tell claude chat it is fixed? Or do I have to get involved?" — no
-- involvement needed). When a dev report's status transitions to 'fixed',
-- this trigger posts Claude's word back into the very room the report was
-- filed from: a chat room gets a Claude message (belling the reporter the
-- ordinary way), a feed thread gets a Claude entry. The builder marking the
-- row fixed IS the announcement — nothing else to remember.
-- Safe against self-reply loops: assistant_on_feed_post fires only WHEN
-- author='member', and assistant_on_message skips assistant senders.
create or replace function public.on_dev_report_fixed()
returns trigger
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_claude uuid := '85c04e7a-5a47-4c0e-85a4-0b35ff67a682';
  v_chat uuid;
  v_body text;
begin
  if new.status <> 'fixed' or old.status = 'fixed' then return new; end if;
  v_body := 'Good news — the issue reported here ("' || new.summary || '") has been fixed by the builders. Thank you for flagging it; reports like this are how the platform gets better. 🌱';
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
    insert into public.assistant_feed_posts (profile_id, author, thread, body)
    values (new.reporter_id, 'claude', substring(new.via from 6), v_body);
  end if;
  return new;
end
$func$;

create trigger on_dev_report_fixed_trg
  after update on public.dev_reports
  for each row execute function public.on_dev_report_fixed();
