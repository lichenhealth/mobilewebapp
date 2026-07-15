-- Hide = your private mute (founder, 2026-07-14). Hiding a post removes it
-- from YOUR feeds only — the author never knows, nothing is signaled.
-- No FK to posts on purpose: a hide survives the post's later deletion.
create table if not exists public.hidden_posts (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  post_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (profile_id, post_id)
);
alter table public.hidden_posts enable row level security;
create policy "hidden: own only" on public.hidden_posts
  for all to authenticated
  using (profile_id = auth.uid()) with check (profile_id = auth.uid());
