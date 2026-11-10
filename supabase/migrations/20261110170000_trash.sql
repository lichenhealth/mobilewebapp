-- THE TRASH (founder 2026-11-10: "a trash that waits with everything until
-- you empty it. There is a meta trash for the entire platform, then a trash
-- for drive, profile, library, courses, etc").
--
-- A delete is still a real delete everywhere (no read path learns a new
-- filter); the trash keeps a SNAPSHOT of the row so Restore can put it back
-- through the table's own insert policy. Nothing auto-purges — it waits
-- until the person empties it. Owner-only.
create table if not exists public.trash_items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  section text not null,
  kind text not null check (kind in ('post','draft','doc','file','folder')),
  label text,
  ref_id uuid,
  payload jsonb not null,
  extra jsonb,
  trashed_at timestamptz not null default now()
);
create index if not exists trash_items_owner on public.trash_items (owner_id, trashed_at desc);
alter table public.trash_items enable row level security;
drop policy if exists "trash own" on public.trash_items;
create policy "trash own" on public.trash_items for all
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
revoke all on public.trash_items from anon;

-- Spam knocks sit in the trash; emptying hides them for good but keeps the
-- labeled row (it still bars re-knocking and is the spam training set).
alter table public.join_requests add column if not exists spam_emptied_at timestamptz;
