-- VERSION HISTORY FOR A PUBLIC PAGE (founder 2026-08-29).
--
-- The founder chose to let Claude keep writing straight to live, reasoning
-- that "you can ask Claude: revert this change and you can go back". That was
-- only half true: the tools report the previous value inside the reply that
-- made the change, and nothing stored it. Ask in the same thread and Claude
-- can put it back; ask tomorrow, or in another thread, and the old words are
-- gone for good. This makes the reasoning true.
--
-- WHY A TRIGGER, not a call at each write site: the page is written from the
-- builder, from every assistant tool, and from the SQL editor, and this
-- codebase has already been bitten twice by a rule enforced at the call sites
-- (the section that rendered twice, the guard that watched one column of
-- three). A trigger cannot be forgotten by code that doesn't know it exists.
create table if not exists public.page_versions (
  id           uuid primary key default gen_random_uuid(),
  subject_type text not null check (subject_type in ('space', 'profile')),
  subject_id   uuid not null,
  -- The page as it was BEFORE the change this row records. Restoring a row
  -- means writing this back, so "undo" is just "publish an old snapshot".
  snapshot     jsonb not null,
  -- Signed-in writes carry a member; the assistant's edge functions use the
  -- service role and have no auth.uid(), which is exactly how we tell the
  -- two apart without asking either of them to be honest about it.
  changed_by   uuid references public.profiles(id) on delete set null,
  source       text not null default 'builder' check (source in ('builder', 'assistant')),
  created_at   timestamptz not null default now()
);

create index if not exists page_versions_subject_idx
  on public.page_versions (subject_type, subject_id, created_at desc);

alter table public.page_versions enable row level security;

-- Same door as the drafts: the member, or a steward of the space. A page's
-- history is not public just because the page is.
drop policy if exists page_versions_read on public.page_versions;
create policy page_versions_read on public.page_versions
  for select using (public.may_edit_page_draft(subject_type, subject_id));

-- ── The recorder ──────────────────────────────────────────────────────────
create or replace function public.snapshot_page_version()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_type text := tg_argv[0];
  v_snap jsonb;
  v_keep constant int := 30;
begin
  if v_type = 'space' then
    if new.page is not distinct from old.page
       and new.description is not distinct from old.description
       and new.contact is not distinct from old.contact then
      return new;
    end if;
    v_snap := jsonb_build_object(
      'page', coalesce(old.page, '{}'::jsonb),
      'description', coalesce(old.description, ''),
      'contact', coalesce(old.contact, '{}'::jsonb));
  else
    if new.page is not distinct from old.page
       and new.contact is not distinct from old.contact then
      return new;
    end if;
    v_snap := jsonb_build_object(
      'page', coalesce(old.page, '{}'::jsonb),
      'contact', coalesce(old.contact, '{}'::jsonb));
  end if;

  insert into public.page_versions (subject_type, subject_id, snapshot, changed_by, source)
  values (v_type, old.id, v_snap, auth.uid(),
          case when auth.uid() is null then 'assistant' else 'builder' end);

  -- A page keeps its last 30 turns. Enough to walk back from a bad afternoon,
  -- not so many that the table becomes a second copy of every page ever.
  delete from public.page_versions old_rows
  where old_rows.id in (
    select id from public.page_versions
    where subject_type = v_type and subject_id = old.id
    order by created_at desc
    offset v_keep
  );
  return new;
end;
$$;

drop trigger if exists spaces_page_version on public.spaces;
create trigger spaces_page_version
  before update on public.spaces
  for each row execute function public.snapshot_page_version('space');

drop trigger if exists profiles_page_version on public.profiles;
create trigger profiles_page_version
  before update on public.profiles
  for each row execute function public.snapshot_page_version('profile');

-- ── Putting one back ──────────────────────────────────────────────────────
-- Restoring is itself a change, so it snapshots the current state on the way
-- past — you can undo an undo.
create or replace function public.restore_page_version(p_version uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.page_versions%rowtype;
begin
  select * into v from public.page_versions where id = p_version;
  if not found then return false; end if;
  -- A signed-in caller must be the member, or a steward of the space. A call
  -- with no auth.uid() is the service role — the assistant's edge functions,
  -- which have already checked stewardship, the space's AI switch and the
  -- member's own edit consent before any tool runs. `anon` cannot reach this
  -- function at all (execute is granted to authenticated and service_role
  -- only), so "no uid" here means service role and nothing else.
  if auth.uid() is not null and not public.may_edit_page_draft(v.subject_type, v.subject_id) then
    raise exception 'Not yours to restore.';
  end if;

  if v.subject_type = 'space' then
    update public.spaces set
      page = coalesce(v.snapshot -> 'page', '{}'::jsonb),
      description = nullif(v.snapshot ->> 'description', ''),
      contact = coalesce(v.snapshot -> 'contact', '{}'::jsonb)
    where id = v.subject_id;
  else
    update public.profiles set
      page = coalesce(v.snapshot -> 'page', '{}'::jsonb),
      contact = coalesce(v.snapshot -> 'contact', '{}'::jsonb)
    where id = v.subject_id;
  end if;
  return true;
end;
$$;

revoke all on function public.restore_page_version(uuid) from public;
grant execute on function public.restore_page_version(uuid) to authenticated, service_role;
