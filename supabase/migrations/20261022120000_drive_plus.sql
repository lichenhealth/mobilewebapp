-- DRIVE'S + CREATES (founder 2026-10-21: "I like the idea of '+' in drive
-- having the same options as the paperclip and '+' as well as a novel post
-- to Lichen"). Two pieces of machinery:
--   1. PERSONAL FILES — a private 'drive' storage bucket + drive_files rows.
--      Owner-only by construction: no sharing, no counts, and NO assistant
--      path ever reads them (the post_drafts posture — what you keep in your
--      own drive is yours alone until you deliberately post it).
--   2. PERSONAL DOCS/SHEETS — chat_docs.chat_id goes nullable: a doc with no
--      room is the owner's alone (read/edit/delete = creator only). Polls
--      stay room-born — a poll with no voters is not a poll.

-- 1 ── Personal files ─────────────────────────────────────────────────────
insert into storage.buckets (id, name, public)
  values ('drive', 'drive', false)
  on conflict (id) do nothing;

create policy "drive bucket own" on storage.objects
  for all
  using (bucket_id = 'drive' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'drive' and (storage.foldername(name))[1] = auth.uid()::text);

create table public.drive_files (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('photo', 'video', 'audio')),
  path text not null,
  title text,
  created_at timestamptz not null default now()
);
create index drive_files_by_owner on public.drive_files (profile_id, created_at desc);
alter table public.drive_files enable row level security;
create policy "drive files own" on public.drive_files
  for all using (profile_id = auth.uid()) with check (profile_id = auth.uid());
grant select, insert, delete on public.drive_files to authenticated;

-- 2 ── Personal docs & sheets ─────────────────────────────────────────────
alter table public.chat_docs alter column chat_id drop not null;

drop policy "chat docs create" on public.chat_docs;
create policy "chat docs create" on public.chat_docs
  for insert with check (
    created_by = auth.uid()
    and (chat_id is null or is_chat_member(chat_id, auth.uid()))
  );

drop policy "chat docs read" on public.chat_docs;
create policy "chat docs read" on public.chat_docs
  for select using (
    case when chat_id is null then created_by = auth.uid()
         else is_chat_member(chat_id, auth.uid()) end
  );

drop policy "chat docs edit" on public.chat_docs;
create policy "chat docs edit" on public.chat_docs
  for update
  using (
    case when chat_id is null then created_by = auth.uid()
         else is_chat_member(chat_id, auth.uid()) end
  )
  with check (
    case when chat_id is null then created_by = auth.uid()
         else is_chat_member(chat_id, auth.uid()) end
  );

-- "chat docs remove" already reads (created_by = auth.uid() OR space admin),
-- which covers a personal doc through its creator — unchanged.

-- The INSERT stamp must not trust a client-sent space_id when there is no
-- room to derive it from (the trigger's whole point).
create or replace function public.chat_docs_before_write()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $func$
begin
  if (TG_OP = 'INSERT') then
    if new.chat_id is null then
      new.space_id := null;   -- a personal doc belongs to no space
    else
      select c.space_id into new.space_id from public.chats c where c.id = new.chat_id;
    end if;
    new.updated_at := now();
    new.updated_by := coalesce(auth.uid(), new.created_by);
    return new;
  end if;
  if new.ai_enabled is distinct from old.ai_enabled then
    if auth.uid() is distinct from old.created_by
       and not (old.space_id is not null and public.is_space_admin(old.space_id, auth.uid())) then
      raise exception 'Only whoever created this (or a space admin) can change its AI setting.';
    end if;
  end if;
  new.chat_id := old.chat_id;        -- a doc never moves rooms by UPDATE
  new.space_id := old.space_id;
  new.kind := old.kind;
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), old.updated_by);
  return new;
end;
$func$;
