-- AUTONOMOUS FIXES SPEAK HUMBLY (founder 2026-08-24: "to keep things safer,
-- say: I'm running these fixes on my own. If something looks funny or isn't
-- working, we can bring Galyn into the conversation"). The night-shift cloud
-- routine marks reports fixed with autonomous=true; the announcement then
-- carries the founder's exact safety framing instead of the plain builder
-- voice, and invites the member to say so in-room if the fix missed —
-- where claude-chat's bring_in_galyn tool can ping her phone with a link.
alter table public.dev_reports add column autonomous boolean not null default false;

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
    insert into public.assistant_feed_posts (profile_id, author, thread, body)
    values (new.reporter_id, 'claude', substring(new.via from 6), v_body);
  end if;
  return new;
end
$func$;
