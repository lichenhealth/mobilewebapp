-- DOCS, POLLS & SPREADSHEETS BORN IN CHAT + THE ROOM DRIVE (founder
-- 2026-10-21: "Let's have docs, polls and spreadsheets be create-able via a
-- chat. So, a plus button in the chat composer with those 3 options. Any docs
-- created via this scenario will live in the drive of that chat and be nested
-- under the greater drive of that group or community. Ai enabled and not can
-- live in the same drive, but maybe we have a little decal that shows a gray
-- brain with a line thru it").
--
-- One table holds all three kinds: a row IS the room-drive item. chat_id is
-- the room it was born in (its drive); space_id is stamped FROM the chat by
-- trigger (never trusted from the client) and is what nests the room's drive
-- under the group's greater drive. ai_enabled is the per-ITEM AI consent —
-- like care_posts.ai_omit, it must be honored by ANY future assistant path
-- that reads these rows (none exists yet; the room-level chats.assistant_enabled
-- and membership gates stack on top).

create table public.chat_docs (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.chats(id) on delete cascade,
  space_id uuid references public.spaces(id) on delete cascade,
  kind text not null check (kind in ('doc', 'poll', 'sheet')),
  title text not null check (btrim(title) <> ''),
  body text,
  data jsonb,
  ai_enabled boolean not null default true,
  created_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);

comment on table public.chat_docs is
  'Docs, polls and spreadsheets created from a chat room''s composer (2026-10-21). The rows ARE the room''s drive; space_id (trigger-stamped from the chat) nests it under the group''s drive. ai_enabled=false = no assistant may ever read the row — any future assistant read path must filter it.';

create index chat_docs_chat_idx on public.chat_docs (chat_id, created_at desc);
create index chat_docs_space_idx on public.chat_docs (space_id) where space_id is not null;

-- space_id is a server-side fact; updated_at/by follow every edit; and the
-- AI switch is the AUTHOR'S (or a space admin's) to flip — a fellow member
-- can edit the words but never widen what reaches an assistant.
create or replace function public.chat_docs_before_write()
returns trigger
language plpgsql security definer set search_path = public
as $func$
begin
  if (TG_OP = 'INSERT') then
    select c.space_id into new.space_id from public.chats c where c.id = new.chat_id;
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

create trigger chat_docs_write
  before insert or update on public.chat_docs
  for each row execute function public.chat_docs_before_write();

alter table public.chat_docs enable row level security;

create policy "chat docs read" on public.chat_docs
  for select using (public.is_chat_member(chat_id, auth.uid()));
create policy "chat docs create" on public.chat_docs
  for insert with check (created_by = auth.uid() and public.is_chat_member(chat_id, auth.uid()));
-- Collaborative by design: any room member may edit the words/cells (the
-- trigger above keeps identity columns and the AI switch honest).
create policy "chat docs edit" on public.chat_docs
  for update using (public.is_chat_member(chat_id, auth.uid()))
  with check (public.is_chat_member(chat_id, auth.uid()));
create policy "chat docs remove" on public.chat_docs
  for delete using (
    created_by = auth.uid()
    or (space_id is not null and public.is_space_admin(space_id, auth.uid()))
  );

-- One vote per member per poll, changeable, retractable. Votes are the
-- poll's working content — room members see WHO chose what (names, the
-- no-counts doctrine's spirit: people, never leaderboards).
create table public.chat_poll_votes (
  doc_id uuid not null references public.chat_docs(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  option_idx int not null check (option_idx >= 0),
  created_at timestamptz not null default now(),
  primary key (doc_id, profile_id)
);

alter table public.chat_poll_votes enable row level security;

create policy "poll votes read" on public.chat_poll_votes
  for select using (exists (
    select 1 from public.chat_docs d
    where d.id = doc_id and public.is_chat_member(d.chat_id, auth.uid())
  ));
create policy "poll votes cast" on public.chat_poll_votes
  for insert with check (
    profile_id = auth.uid()
    and exists (
      select 1 from public.chat_docs d
      where d.id = doc_id and d.kind = 'poll' and public.is_chat_member(d.chat_id, auth.uid())
    )
  );
create policy "poll votes change" on public.chat_poll_votes
  for update using (profile_id = auth.uid()) with check (profile_id = auth.uid());
create policy "poll votes retract" on public.chat_poll_votes
  for delete using (profile_id = auth.uid());

-- Live tallies in the room (the chat_messages realtime pattern).
alter publication supabase_realtime add table public.chat_poll_votes;
