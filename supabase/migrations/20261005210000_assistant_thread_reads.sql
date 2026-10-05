-- ASSISTANT THREAD READ CURSORS (founder 2026-10-05: the thread rail's
-- badges showed LIFETIME entry counts in notification grammar — "old/stale
-- notifications" that never cleared). The badge means "replies you haven't
-- seen" now, which needs a per-member per-thread cursor — the chat
-- last_read_at pattern, sized for the assistant feed. Owner-only, like the
-- feed rows themselves.
create table if not exists public.assistant_thread_reads (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  thread     text not null,
  read_at    timestamptz not null default now(),
  primary key (profile_id, thread)
);

alter table public.assistant_thread_reads enable row level security;

drop policy if exists "thread reads: own" on public.assistant_thread_reads;
create policy "thread reads: own" on public.assistant_thread_reads
  for all using (profile_id = auth.uid()) with check (profile_id = auth.uid());

grant select, insert, update, delete on public.assistant_thread_reads to authenticated;
