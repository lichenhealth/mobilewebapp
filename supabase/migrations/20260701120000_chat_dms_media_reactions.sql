-- =============================================================================
-- Chat: 1:1 direct messages, message attachments, reactions & replies.
--
-- NOT auto-applied. Run in the Supabase SQL editor (dashboard), then refresh the
-- init.sql baseline with pg_dump. Idempotent where practical so it is safe to
-- re-run.
--
-- Three features:
--   1a. Direct (1:1) chats — a new `direct` chat kind + a race-safe find-or-create
--       RPC (mirrors ensure_care_chat, but ON CONFLICT-safe: the existing care
--       function is racy — do not copy it verbatim).
--   1b. Message attachments — a private `chat-media` bucket + an `attachments`
--       jsonb column; body becomes optional (attachment-only messages allowed).
--   1c. Reactions & replies — a reactions table (realtime) + a reply_to column.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1a. Direct-message chats
-- -----------------------------------------------------------------------------

-- `chats.kind` is a text + CHECK column (not a pg enum), so adding a value is
-- just a CHECK swap — no separate migration needed.
alter table public.chats drop constraint if exists chats_kind_check;
alter table public.chats add constraint chats_kind_check
  check (kind = any (array['organization','community','group','place','care_team','direct']));

-- Dedupe key: the two participant uuids, sorted + joined ("a:b"), so a pair maps
-- to exactly one direct chat regardless of who opens it first.
alter table public.chats add column if not exists direct_key text;
create unique index if not exists chats_direct_uidx
  on public.chats (direct_key) where direct_key is not null;

-- Find-or-create the direct chat between the caller and p_other. SECURITY DEFINER
-- so it can insert into chats / chat_members (which have no client INSERT policy).
create or replace function public.ensure_direct_chat(p_other uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me   uuid := auth.uid();
  v_key  text;
  v_chat uuid;
begin
  if v_me is null then raise exception 'Not signed in'; end if;
  if p_other is null or p_other = v_me then raise exception 'Invalid recipient'; end if;
  if not exists (select 1 from public.profiles where id = p_other) then
    raise exception 'No such member';
  end if;

  v_key := case when v_me < p_other
                then v_me::text || ':' || p_other::text
                else p_other::text || ':' || v_me::text end;

  select id into v_chat from public.chats where direct_key = v_key;
  if v_chat is null then
    insert into public.chats (kind, direct_key, title)
    values ('direct', v_key, null)
    on conflict (direct_key) where direct_key is not null do nothing
    returning id into v_chat;

    if v_chat is null then                      -- lost the race; fetch the winner
      select id into v_chat from public.chats where direct_key = v_key;
    end if;

    insert into public.chat_members (chat_id, profile_id) values (v_chat, v_me)    on conflict do nothing;
    insert into public.chat_members (chat_id, profile_id) values (v_chat, p_other) on conflict do nothing;
  end if;

  return v_chat;
end;
$$;

revoke all on function public.ensure_direct_chat(uuid) from public, anon;
grant execute on function public.ensure_direct_chat(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 1b. Message attachments (+ replies column, used by 1c)
-- -----------------------------------------------------------------------------

-- attachments: null or a jsonb array of { type: 'photo'|'video'|'audio', url }.
-- `url` stores the storage PATH (not a signed URL) so the row never goes stale;
-- the client signs paths at render time.
alter table public.chat_messages add column if not exists attachments jsonb;

-- reply_to: the quoted message. SET NULL (not cascade) so deleting a quoted
-- message doesn't nuke the reply — the UI just shows "message unavailable".
alter table public.chat_messages add column if not exists reply_to uuid
  references public.chat_messages(id) on delete set null;

-- Allow attachment-only messages: body becomes optional, but a message must
-- carry text OR at least one attachment.
alter table public.chat_messages alter column body drop not null;
alter table public.chat_messages drop constraint if exists chat_messages_content_chk;
alter table public.chat_messages add constraint chat_messages_content_chk
  check (
    (body is not null and length(btrim(body)) > 0)
    or (attachments is not null and jsonb_array_length(attachments) > 0)
  );

-- Private storage bucket for chat media. Files live under `<chat_id>/<file>` so
-- the storage policies can gate on chat membership.
insert into storage.buckets (id, name, public)
values ('chat-media', 'chat-media', false)
on conflict (id) do nothing;

-- Only chat members may upload into (and read/delete from) that chat's folder.
drop policy if exists "chat-media: member read"   on storage.objects;
drop policy if exists "chat-media: member upload" on storage.objects;
drop policy if exists "chat-media: member delete" on storage.objects;

create policy "chat-media: member read"
  on storage.objects for select to authenticated
  using (bucket_id = 'chat-media'
         and public.is_chat_member(((storage.foldername(name))[1])::uuid, auth.uid()));

create policy "chat-media: member upload"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'chat-media'
             and public.is_chat_member(((storage.foldername(name))[1])::uuid, auth.uid()));

create policy "chat-media: member delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'chat-media'
         and public.is_chat_member(((storage.foldername(name))[1])::uuid, auth.uid()));

-- -----------------------------------------------------------------------------
-- 1c. Reactions
-- -----------------------------------------------------------------------------

-- chat_id is denormalized so the realtime subscription can filter chat_id=eq.<id>
-- (a realtime filter can't join), and so the RLS policy is a simple membership check.
create table if not exists public.chat_message_reactions (
  message_id uuid not null references public.chat_messages(id) on delete cascade,
  chat_id    uuid not null references public.chats(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  emoji      text not null,
  created_at timestamptz not null default now(),
  primary key (message_id, profile_id, emoji)
);

-- The `rls_auto_enable` event trigger enables RLS on new public tables, so a
-- table with no policies would be fully locked — ship the policies together.
alter table public.chat_message_reactions enable row level security;

drop policy if exists "reactions read"   on public.chat_message_reactions;
drop policy if exists "reactions add"    on public.chat_message_reactions;
drop policy if exists "reactions remove" on public.chat_message_reactions;

create policy "reactions read" on public.chat_message_reactions
  for select to authenticated
  using (public.is_chat_member(chat_id, auth.uid()));

create policy "reactions add" on public.chat_message_reactions
  for insert to authenticated
  with check (profile_id = auth.uid() and public.is_chat_member(chat_id, auth.uid()));

create policy "reactions remove" on public.chat_message_reactions
  for delete to authenticated
  using (profile_id = auth.uid() and public.is_chat_member(chat_id, auth.uid()));

-- Realtime: add to the publication, and REPLICA IDENTITY FULL so DELETE payloads
-- carry chat_id (otherwise the chat_id=eq.<id> filter won't match un-reacts and
-- removed reactions won't disappear live for other members).
alter table public.chat_message_reactions replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'chat_message_reactions'
  ) then
    alter publication supabase_realtime add table public.chat_message_reactions;
  end if;
end $$;
