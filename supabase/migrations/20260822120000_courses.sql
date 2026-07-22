-- COURSES & PATHS (2026-07-22): a course/path is a Collection with structure —
-- ordered lessons, a legible "offering" (level/format/length/who-for/price), and
-- per-learner progress. Reuses the collections primitive; no separate LMS.

-- Distinguish a plain saved folder from a published course (Courses) / path (Library).
alter table public.collections
  add column if not exists kind text not null default 'collection';
alter table public.collections
  drop constraint if exists collections_kind_check;
alter table public.collections
  add constraint collections_kind_check check (kind in ('collection', 'course', 'path'));

-- Legible offering metadata (all optional): { level, format, length, forWhom, price }.
alter table public.collections
  add column if not exists details jsonb not null default '{}';

-- Per-learner enrollment ("Start") — private to the learner, like saved_items.
create table public.collection_enrollments (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  collection_id uuid not null references public.collections(id) on delete cascade,
  enrolled_at timestamptz not null default now(),
  primary key (profile_id, collection_id)
);
alter table public.collection_enrollments enable row level security;
create policy col_enroll_own on public.collection_enrollments for all
  using (profile_id = auth.uid()) with check (profile_id = auth.uid());

-- Per-learner per-lesson completion — private to the learner.
create table public.collection_progress (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  collection_id uuid not null references public.collections(id) on delete cascade,
  post_id uuid not null references public.posts(id) on delete cascade,
  done_at timestamptz not null default now(),
  primary key (profile_id, collection_id, post_id)
);
alter table public.collection_progress enable row level security;
create policy col_progress_own on public.collection_progress for all
  using (profile_id = auth.uid()) with check (profile_id = auth.uid());

create index collection_progress_lookup on public.collection_progress (profile_id, collection_id);
