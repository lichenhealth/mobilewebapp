-- THE MESSAGE MENU (founder 2026-10-21: "The three dots should allow me to
-- choose many options. Reply, React …, Share, Copy, Save (which saves it to
-- drive) and Delete - if its my post, it will delete for all, if someone
-- else's, it will only delete for me if I'm not an admin. If I am an admin,
-- it will ask if I want to delete for the group").
--
-- Three pieces of machinery:
--   1. saved_items learns 'message' — Save-to-Drive by reference.
--   2. hidden_messages — "delete for me": the member's own curtain over a
--      message, nobody else affected (the hidden_posts idiom: NO FK to the
--      message, a hide survives the message's deletion).
--   3. Delete-for-all: senders may DELETE their own rows (reply_to is
--      ON DELETE SET NULL and reactions CASCADE, so a hard delete is clean),
--      and a SPACE ADMIN may delete anyone's message in their space's rooms
--      via moderate_delete_chat_message() — stewardship, checked server-side.

-- 1 ── Save a message to Drive ────────────────────────────────────────────
alter table public.saved_items drop constraint saved_items_target_type_check;
alter table public.saved_items add constraint saved_items_target_type_check
  check (target_type = any (array['post'::text, 'profile'::text, 'space'::text, 'event'::text, 'message'::text]));

-- 2 ── Delete for me ──────────────────────────────────────────────────────
create table public.hidden_messages (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  -- Deliberately no FK to chat_messages: a hide survives the message's
  -- later deletion (hidden_posts' rule), and chat_id rides along so one
  -- room's hides load in one read.
  message_id uuid not null,
  chat_id    uuid not null,
  created_at timestamptz not null default now(),
  primary key (profile_id, message_id)
);
create index hidden_messages_by_chat on public.hidden_messages (profile_id, chat_id);
alter table public.hidden_messages enable row level security;
create policy "hidden messages own" on public.hidden_messages
  for all using (profile_id = auth.uid()) with check (profile_id = auth.uid());
grant select, insert, delete on public.hidden_messages to authenticated;

-- 3a ── Delete for all: your own words are yours to take back ─────────────
create policy "messages delete own" on public.chat_messages
  for delete using (sender_id = auth.uid());
grant delete on public.chat_messages to authenticated;

-- 3b ── A space admin deletes for the group ───────────────────────────────
create or replace function public.moderate_delete_chat_message(p_message uuid)
returns void
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_chat uuid;
  v_space uuid;
  v_kind text;
begin
  select m.chat_id, c.space_id, c.kind::text into v_chat, v_space, v_kind
  from chat_messages m join chats c on c.id = m.chat_id
  where m.id = p_message;
  if v_chat is null then
    raise exception 'That message is already gone.';
  end if;
  if v_space is null or v_kind not in ('organization','community','group','place') then
    raise exception 'Only a space''s own rooms have steward moderation.';
  end if;
  if not is_space_admin(v_space, auth.uid()) then
    raise exception 'Only this space''s admins can delete someone else''s message for the group.';
  end if;
  delete from chat_messages where id = p_message;
end;
$func$;
revoke all on function public.moderate_delete_chat_message(uuid) from public, anon;
grant execute on function public.moderate_delete_chat_message(uuid) to authenticated;
