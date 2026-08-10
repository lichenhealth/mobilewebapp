-- FIX (founder architecture audit, 2026-08-09): 20260909130000_public_pages_
-- defaults.sql set spaces.public_page's column DEFAULT to a flat `false` for
-- every kind, only backfilling EXISTING rows to the intended
-- true-for-org/place, false-for-community/group split. Every space created
-- since then — any kind — has gotten `false` regardless, so new
-- organizations/places have been silently invisible to the open web.
--
-- A column DEFAULT can't reference another column of the same row, so the
-- kind-aware default has to be a BEFORE INSERT trigger instead. Dropping the
-- static default (column stays NOT NULL) so a caller that doesn't specify
-- public_page arrives as NULL and the trigger fills it in correctly; a
-- caller that explicitly sets it (none do today) is left alone.

alter table public.spaces alter column public_page drop default;

create or replace function public.set_space_public_page_default()
returns trigger language plpgsql as $$
begin
  if new.public_page is null then
    new.public_page := (new.kind in ('organization', 'place'));
  end if;
  return new;
end;
$$;

create trigger before_space_public_page_default
  before insert on public.spaces
  for each row execute function public.set_space_public_page_default();
