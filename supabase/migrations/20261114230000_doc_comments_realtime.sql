-- Office suite 2 (founder 2026-11-14): comments on Docs, Sheets and Slides,
-- and live co-editing ("lets have this be cloud, so things auto save").

-- Who may see a doc: a room doc → the room's members; a personal doc → its owner.
create or replace function public.can_see_chat_doc(p_doc uuid, p_uid uuid)
returns boolean language sql stable security definer set search_path = public as $fn$
  select exists (
    select 1 from chat_docs d
    where d.id = p_doc
      and ((d.chat_id is null and d.created_by = p_uid)
        or (d.chat_id is not null and is_chat_member(d.chat_id, p_uid)))
  );
$fn$;
revoke all on function public.can_see_chat_doc(uuid, uuid) from public, anon;
grant execute on function public.can_see_chat_doc(uuid, uuid) to authenticated;

create table if not exists public.doc_comments (
  id uuid primary key default gen_random_uuid(),
  doc_id uuid not null references public.chat_docs(id) on delete cascade,
  parent_id uuid references public.doc_comments(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  body text not null check (char_length(body) between 1 and 4000),
  anchor jsonb,           -- {kind:'text',quote} | {kind:'cell',tab,r,c} | {kind:'slide',index}
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists doc_comments_doc on public.doc_comments(doc_id, created_at);
alter table public.doc_comments enable row level security;

create policy "doc comments read" on public.doc_comments for select to authenticated
  using (can_see_chat_doc(doc_id, auth.uid()));
create policy "doc comments write" on public.doc_comments for insert to authenticated
  with check (author_id = auth.uid() and can_see_chat_doc(doc_id, auth.uid()));
-- Anyone who can see the doc may resolve/reopen (Google's grammar); only the
-- author may change the words — enforced by the trigger below.
create policy "doc comments update" on public.doc_comments for update to authenticated
  using (can_see_chat_doc(doc_id, auth.uid())) with check (can_see_chat_doc(doc_id, auth.uid()));
create policy "doc comments delete" on public.doc_comments for delete to authenticated
  using (author_id = auth.uid()
    or exists (select 1 from chat_docs d where d.id = doc_id and d.created_by = auth.uid()));

create or replace function public.doc_comments_guard()
returns trigger language plpgsql as $fn$
begin
  if new.doc_id <> old.doc_id or new.author_id <> old.author_id
     or new.parent_id is distinct from old.parent_id or new.anchor is distinct from old.anchor then
    raise exception 'A comment stays where it was written.';
  end if;
  if new.body <> old.body and old.author_id <> auth.uid() then
    raise exception 'Only the person who wrote a comment can change its words.';
  end if;
  if new.resolved_at is distinct from old.resolved_at then
    new.resolved_by := case when new.resolved_at is null then null else auth.uid() end;
  end if;
  new.updated_at := now();
  return new;
end $fn$;
drop trigger if exists doc_comments_guard on public.doc_comments;
create trigger doc_comments_guard before update on public.doc_comments
  for each row execute function public.doc_comments_guard();

-- A bell: the doc's creator and everyone already in the thread hear a new
-- comment (never the person who wrote it).
create or replace function public.on_doc_comment()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare d record; who text; rcpt uuid; root uuid;
begin
  select id, title, created_by, chat_id into d from chat_docs where id = new.doc_id;
  select coalesce(full_name, 'Someone') into who from profiles where id = new.author_id;
  root := coalesce(new.parent_id, new.id);
  for rcpt in
    select distinct x from (
      select d.created_by as x
      union select author_id from doc_comments where id = root or parent_id = root
    ) s where x is not null and x <> new.author_id
  loop
    perform notify(rcpt, 'chat', null, 'doc_comment',
      who || case when new.parent_id is null then ' commented on ' else ' replied in ' end || '«' || coalesce(nullif(d.title, ''), 'Untitled') || '»',
      left(new.body, 140), '/docs/' || d.id::text || '?comment=' || root::text, new.author_id);
  end loop;
  return new;
end $fn$;
drop trigger if exists on_doc_comment on public.doc_comments;
create trigger on_doc_comment after insert on public.doc_comments
  for each row execute function public.on_doc_comment();

-- Live: comments and the docs themselves stream to everyone with the doc open.
do $do$ begin
  begin alter publication supabase_realtime add table public.doc_comments; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.chat_docs; exception when duplicate_object then null; end;
end $do$;
