-- ASSESSMENTS (founder 2026-09-22: "assessments are time stamped once
-- submitted, so we can look at assessments over time... editable until
-- submitted... only one score per category per assessment"). An assessment
-- groups the intake's six entries; it stays open (editable in the intake)
-- until Finish stamps submitted_at, and the next intake visit starts a new
-- one. One open assessment per member, structurally.
create table public.wow_assessments (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  submitted_at timestamptz
);
alter table public.wow_assessments enable row level security;
create policy "wow_assessments own" on public.wow_assessments
  for all using (profile_id = auth.uid()) with check (profile_id = auth.uid());
create unique index wow_assessments_one_open
  on public.wow_assessments (profile_id) where submitted_at is null;

alter table public.care_posts
  add column if not exists assessment_id uuid references public.wow_assessments(id) on delete set null;
