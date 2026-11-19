-- NESTED FOLDERS (founder 2026-11-19: "lets build nesting folders" — Lichen
-- folders sat flat; a Google folder import flattened into "Parent / Sub").
-- A folder (collections row) may now sit inside another folder.
--
-- Rules, enforced here so no client can forget them:
--   • a folder nests only inside a folder of the SAME home — same owner and
--     both personal, or the same space;
--   • never inside itself or its own sub-folders (no cycles), 12 levels max;
--   • deleting a folder never deletes what's inside it: its sub-folders move
--     up (see 20261119161000 — that step now lives in the app's delete doors).

alter table public.collections
  add column if not exists parent_id uuid references public.collections(id) on delete set null;

create index if not exists collections_parent_idx on public.collections(parent_id) where parent_id is not null;

create or replace function public.collections_guard_parent()
returns trigger
language plpgsql
security definer
set search_path = public
as $func$
declare
  p record;
  cur uuid;
  depth int := 0;
begin
  if new.parent_id is null then return new; end if;
  if new.parent_id = new.id then
    raise exception 'A folder can''t go inside itself.';
  end if;
  select id, owner_id, space_id, parent_id into p from public.collections where id = new.parent_id;
  if not found then
    raise exception 'That folder isn''t there anymore.';
  end if;
  if new.space_id is null then
    if p.space_id is not null or p.owner_id <> new.owner_id then
      raise exception 'A folder can only go inside another of your own folders.';
    end if;
  elsif p.space_id is distinct from new.space_id then
    raise exception 'A folder can only go inside another folder of the same group.';
  end if;
  -- Walk up from the new parent: meeting this folder means a loop.
  cur := new.parent_id;
  while cur is not null loop
    depth := depth + 1;
    if cur = new.id then
      raise exception 'A folder can''t go inside one of its own folders.';
    end if;
    if depth > 12 then
      raise exception 'Folders nest up to 12 levels deep.';
    end if;
    select parent_id into cur from public.collections where id = cur;
  end loop;
  return new;
end;
$func$;

drop trigger if exists collections_guard_parent on public.collections;
create trigger collections_guard_parent
  before insert or update of parent_id on public.collections
  for each row execute function public.collections_guard_parent();

-- Deleting a folder lifts its sub-folders to where it sat.
create or replace function public.collections_lift_children()
returns trigger
language plpgsql
security definer
set search_path = public
as $func$
begin
  update public.collections set parent_id = old.parent_id where parent_id = old.id;
  return old;
end;
$func$;

drop trigger if exists collections_lift_children on public.collections;
create trigger collections_lift_children
  before delete on public.collections
  for each row execute function public.collections_lift_children();

revoke execute on function public.collections_guard_parent() from public, anon, authenticated;
revoke execute on function public.collections_lift_children() from public, anon, authenticated;
