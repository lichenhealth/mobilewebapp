-- Save = your private shelf (founder, 2026-07-14: "your universal hard
-- drive to manage content on the platform"). Nobody else can read what you
-- save — no counts, no signals, not even to the author. Polymorphic like
-- mycelium; the UI uses 'post' today (posts cover listings/courses/events/
-- library pieces), with room for entities later.
create table if not exists public.saved_items (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  target_type text not null default 'post'
    check (target_type in ('post', 'profile', 'space', 'event')),
  target_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (profile_id, target_type, target_id)
);
alter table public.saved_items enable row level security;
create policy "saves: own only" on public.saved_items
  for all to authenticated
  using (profile_id = auth.uid()) with check (profile_id = auth.uid());
