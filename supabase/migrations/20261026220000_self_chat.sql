-- THE SELF TEXT (founder 2026-10-26: "I get why you can't chat with yourself,
-- but maybe you should be able to text yourself things - so let's have chat
-- lead to a self text"): a member's own notes-to-self thread, the sibling of
-- ensure_direct_chat with one seat. kind stays 'direct'; the direct_key is
-- the member's id twice ('me:me'), which can never collide with a real pair
-- (ensure_direct_chat refuses p_other = caller, so no pair key ever repeats
-- an id). The client names it "Note to self" and wears the member's own face.
-- No bell machinery needed: on_message_notify bells OTHER members, and a
-- self chat has none.

create or replace function public.ensure_self_chat()
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $func$
declare
  v_me   uuid := auth.uid();
  v_key  text;
  v_chat uuid;
begin
  if v_me is null then raise exception 'Not signed in'; end if;

  v_key := v_me::text || ':' || v_me::text;

  select id into v_chat from public.chats where direct_key = v_key;
  if v_chat is null then
    insert into public.chats (kind, direct_key, title)
    values ('direct', v_key, null)
    on conflict (direct_key) where direct_key is not null do nothing
    returning id into v_chat;

    if v_chat is null then
      select id into v_chat from public.chats where direct_key = v_key;
    end if;

    insert into public.chat_members (chat_id, profile_id) values (v_chat, v_me)
    on conflict do nothing;
  end if;

  return v_chat;
end;
$func$;

revoke execute on function public.ensure_self_chat() from public, anon;
grant execute on function public.ensure_self_chat() to authenticated;
