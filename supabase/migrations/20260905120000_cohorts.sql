-- COHORTS (founder 2026-07-28): a cohort is a GROUP with two more facts —
-- which course it runs, and which turn of it. Deliberately NOT a new
-- space_kind: groups already carry chat, calendar, events, find-a-time,
-- duties, nesting and consented membership, and every one of those would
-- have to be re-granted to a new kind. The word is free; the kind is not.
--
-- A course can now hold MANY cohorts (Spring, Fall, Colorado Kapulli 2026),
-- each graduating on its own timeline while the course itself persists.

alter table public.spaces
  add column if not exists cohort_of uuid references public.collections(id) on delete set null,
  add column if not exists term text;

create index if not exists spaces_cohort_of_idx on public.spaces (cohort_of) where cohort_of is not null;

-- Both columns ride the existing spaces SELECT grant (the table is readable
-- to authenticated members) and the existing admin UPDATE policy — a cohort
-- is edited by the same people who edit any group.
