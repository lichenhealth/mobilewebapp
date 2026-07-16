-- Chat read state (founder, 2026-07-15): per-conversation unread counts in
-- the inbox (Signal-style badges), and opening a chat marks it read AND
-- clears that chat's bell notifications in one call. Existing memberships
-- start "caught up" (default now()); unread = messages newer than your
-- cursor that you didn't send. Covers ALL chat kinds — including group/
-- community chats, which deliberately never produce notifications.

alter table public.chat_members
  add column if not exists last_read_at timestamptz not null default now();

-- Also speeds the inbox preview scan and thread loads.
create index if not exists chat_messages_chat_created_idx
  on public.chat_messages (chat_id, created_at desc);

create or replace function public.mark_chat_read(p_chat uuid) returns void
language plpgsql security definer set search_path to 'public' as $$
begin
  update public.chat_members set last_read_at = now()
    where chat_id = p_chat and profile_id = auth.uid();
  if not found then return; end if;   -- not a member: touch nothing
  update public.notifications set read_at = now()
    where recipient_id = auth.uid() and section = 'chat'
      and link = '/chat/' || p_chat and read_at is null;
end;
$$;

grant execute on function public.mark_chat_read(uuid) to authenticated;

-- Unread counts for MY conversations (invoker rights; RLS already scopes
-- both tables to chats I belong to).
create or replace function public.chat_unread_counts()
returns table(chat_id uuid, unread bigint)
language sql stable as $$
  select m.chat_id, count(msg.id)
  from public.chat_members m
  join public.chat_messages msg
    on msg.chat_id = m.chat_id
   and msg.created_at > m.last_read_at
   and msg.sender_id <> auth.uid()
  where m.profile_id = auth.uid()
  group by m.chat_id;
$$;

grant execute on function public.chat_unread_counts() to authenticated;
