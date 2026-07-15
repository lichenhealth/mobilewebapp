-- Collections: one primitive, two faces (founder, 2026-07-14). Private =
-- named folders organizing your Saved shelf. Public = playlists/anthologies
-- published to the Lichen Library — curation as contribution, curator
-- attributed. A public collection is CONTENT (visible to everyone), not an
-- endorsement signal; trust/recommend privacy rules are untouched.
create table if not exists public.collections (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  description text,
  is_public boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.collections enable row level security;
create policy "collections: read own or public" on public.collections
  for select to authenticated using (owner_id = auth.uid() or is_public);
create policy "collections: insert own" on public.collections
  for insert to authenticated with check (owner_id = auth.uid());
create policy "collections: update own" on public.collections
  for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "collections: delete own" on public.collections
  for delete to authenticated using (owner_id = auth.uid());

create table if not exists public.collection_items (
  collection_id uuid not null references public.collections(id) on delete cascade,
  target_type text not null default 'post' check (target_type in ('post')),
  target_id uuid not null,
  position integer not null default 0,
  added_at timestamptz not null default now(),
  primary key (collection_id, target_type, target_id)
);
alter table public.collection_items enable row level security;
create policy "citems: read via collection" on public.collection_items
  for select to authenticated using (
    exists (select 1 from public.collections c
            where c.id = collection_items.collection_id
              and (c.owner_id = auth.uid() or c.is_public))
  );
create policy "citems: write own" on public.collection_items
  for all to authenticated using (
    exists (select 1 from public.collections c
            where c.id = collection_items.collection_id and c.owner_id = auth.uid())
  ) with check (
    exists (select 1 from public.collections c
            where c.id = collection_items.collection_id and c.owner_id = auth.uid())
  );
