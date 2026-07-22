-- TO-DO LIST (founder, 2026-07-22): a checklist that lives as a calendar view.
-- Reminders auto-populate it by day (from their own table); these `todos` are
-- the free-form items you add and check off. Strictly owner-only, like
-- reminders and saved_items — nobody else's list is visible.

create table public.todos (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  done boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.todos enable row level security;
create policy todos_own_all on public.todos for all to authenticated
  using (profile_id = auth.uid()) with check (profile_id = auth.uid());

create index todos_owner_idx on public.todos (profile_id, done, created_at);
