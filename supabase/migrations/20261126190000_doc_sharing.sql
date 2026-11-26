-- SHARE A DOC LIKE GOOGLE (founder 2026-11-26: "how do I share this from
-- the doc itself like i can on google?").
-- A personal doc (chat_id null) was owner-only. Now its owner can
--   (1) share it with named members — Can view / Can edit (chat_doc_shares)
--   (2) open a link — 'lichen' = any signed-in member with the link reads it,
--       'anyone' = the open web reads it too (read-only, via shared_doc()).
-- Room docs keep their room's membership; sharing is for personal docs.

create table if not exists public.chat_doc_shares (
  doc_id uuid not null references public.chat_docs(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  level text not null default 'view' check (level in ('view','edit')),
  created_by uuid not null default auth.uid() references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (doc_id, profile_id)
);
alter table public.chat_doc_shares enable row level security;

alter table public.chat_docs
  add column if not exists link_access text check (link_access in ('lichen','anyone')),
  add column if not exists share_token text unique;

-- Helpers (SECURITY DEFINER — the docs policy reads shares and the shares
-- policy reads docs; routing through these keeps them out of a cycle).
create or replace function public.owns_personal_doc(p_doc uuid, p_uid uuid)
returns boolean language sql stable security definer set search_path = public as $f$
  select exists (select 1 from chat_docs where id = p_doc and chat_id is null and created_by = p_uid);
$f$;

create or replace function public.doc_share_level(p_doc uuid, p_uid uuid)
returns text language sql stable security definer set search_path = public as $f$
  select level from chat_doc_shares where doc_id = p_doc and profile_id = p_uid;
$f$;

drop policy if exists "doc shares owner" on public.chat_doc_shares;
create policy "doc shares owner" on public.chat_doc_shares for all to authenticated
  using (public.owns_personal_doc(doc_id, auth.uid()))
  with check (public.owns_personal_doc(doc_id, auth.uid()));
drop policy if exists "doc shares mine" on public.chat_doc_shares;
create policy "doc shares mine" on public.chat_doc_shares for select to authenticated
  using (profile_id = auth.uid());
-- Someone a doc was shared with may step out of it.
drop policy if exists "doc shares leave" on public.chat_doc_shares;
create policy "doc shares leave" on public.chat_doc_shares for delete to authenticated
  using (profile_id = auth.uid());

-- Docs read/edit: the old arms verbatim + the shared arms.
drop policy if exists "chat docs read" on public.chat_docs;
create policy "chat docs read" on public.chat_docs for select to authenticated using (
  case when chat_id is null then
    created_by = auth.uid()
    or public.doc_share_level(id, auth.uid()) is not null
    or link_access in ('lichen','anyone')
  else is_chat_member(chat_id, auth.uid()) end
);
drop policy if exists "chat docs edit" on public.chat_docs;
create policy "chat docs edit" on public.chat_docs for update to authenticated using (
  case when chat_id is null then created_by = auth.uid() or public.doc_share_level(id, auth.uid()) = 'edit'
  else is_chat_member(chat_id, auth.uid()) end
) with check (
  case when chat_id is null then created_by = auth.uid() or public.doc_share_level(id, auth.uid()) = 'edit'
  else is_chat_member(chat_id, auth.uid()) end
);

-- Comments + doc media follow whoever can read the doc.
create or replace function public.can_see_chat_doc(p_doc uuid, p_uid uuid)
returns boolean language sql stable security definer set search_path = public as $function$
  select exists (
    select 1 from chat_docs d
    where d.id = p_doc
      and ((d.chat_id is null and (d.created_by = p_uid
              or exists (select 1 from chat_doc_shares s where s.doc_id = d.id and s.profile_id = p_uid)
              or (p_uid is not null and d.link_access in ('lichen','anyone'))))
        or (d.chat_id is not null and is_chat_member(d.chat_id, p_uid)))
  );
$function$;

-- The write guard: only the creator changes who it's shared with, its link
-- and its AI setting; a shared editor edits the words.
create or replace function public.chat_docs_before_write()
returns trigger language plpgsql security definer set search_path = public as $function$
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
  if (new.link_access is distinct from old.link_access or new.share_token is distinct from old.share_token)
     and auth.uid() is not null and auth.uid() is distinct from old.created_by then
    raise exception 'Only whoever created this doc can change its link.';
  end if;
  if new.link_access is not null and old.chat_id is not null then
    raise exception 'A room''s doc follows its room — share it from a personal copy.';
  end if;
  if new.link_access is not null and new.share_token is null then
    new.share_token := replace(gen_random_uuid()::text, '-', '');
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
$function$;

-- A bell for whoever it's shared with.
create or replace function public.on_doc_shared()
returns trigger language plpgsql security definer set search_path = public as $f$
declare d record; who text;
begin
  select id, title into d from chat_docs where id = new.doc_id;
  select coalesce(full_name, 'Someone') into who from profiles where id = coalesce(new.created_by, auth.uid());
  perform notify(new.profile_id, 'home', null, 'doc_shared',
    who || ' shared «' || coalesce(nullif(d.title, ''), 'Untitled') || '» with you',
    case when new.level = 'edit' then 'You can edit it.' else 'You can view it.' end,
    '/docs/' || d.id::text, new.created_by);
  return new;
end $f$;
drop trigger if exists doc_shared_notify on public.chat_doc_shares;
create trigger doc_shared_notify after insert on public.chat_doc_shares
  for each row execute function public.on_doc_shared();

-- The open web reads an 'anyone' doc by its token — read-only, nothing more.
create or replace function public.shared_doc(p_token text)
returns table (id uuid, kind text, title text, body text, data jsonb, owner_name text, updated_at timestamptz, link_access text)
language sql stable security definer set search_path = public as $f$
  select d.id, d.kind, d.title, d.body, d.data, p.full_name, d.updated_at, d.link_access
  from chat_docs d left join profiles p on p.id = d.created_by
  where d.share_token = p_token and d.chat_id is null
    and (d.link_access = 'anyone' or (d.link_access = 'lichen' and auth.uid() is not null));
$f$;
revoke all on function public.shared_doc(text) from public;
grant execute on function public.shared_doc(text) to anon, authenticated;

-- Pictures inside a shared doc: whoever may read the doc may sign them.
create or replace function public.drive_object_in_visible_doc(p_name text, p_uid uuid)
returns boolean language sql stable security definer set search_path = public as $f$
  select p_uid is not null and exists (
    select 1 from chat_docs d
    where d.chat_id is null
      and (d.created_by::text = split_part(p_name, '/', 1)
           or exists (select 1 from chat_doc_shares s2 where s2.doc_id = d.id and s2.profile_id::text = split_part(p_name, '/', 1)))
      and position(p_name in coalesce(d.data::text, '')) > 0
      and (d.created_by = p_uid
           or exists (select 1 from chat_doc_shares s where s.doc_id = d.id and s.profile_id = p_uid)
           or d.link_access in ('lichen','anyone'))
  );
$f$;
drop policy if exists "drive shared doc pictures" on storage.objects;
create policy "drive shared doc pictures" on storage.objects for select to authenticated
  using (bucket_id = 'drive' and public.drive_object_in_visible_doc(name, auth.uid()));
