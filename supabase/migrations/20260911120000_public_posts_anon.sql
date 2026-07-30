-- PUBLIC POSTS ARE THE OPEN WEB (founder 2026-07-29, the lichen.health
-- consolidation): the marketing site's essays now live as public Library
-- posts, and signed-out visitors must be able to read them — every essay
-- ends in an invitation to join. Anon reads ONLY visibility='public' rows;
-- mycelium- and space-scoped posts stay members-only, unchanged.

grant select on public.posts to anon;
create policy "posts: public read (anon)" on public.posts
  for select to anon using (visibility = 'public');

-- Published collections (the essays shelf, the bookshelf) read the same way.
grant select on public.collections to anon;
create policy "collections: public read (anon)" on public.collections
  for select to anon using (is_public);

grant select on public.collection_items to anon;
create policy "collection_items: public read (anon)" on public.collection_items
  for select to anon
  using (exists (select 1 from public.collections c
                 where c.id = collection_id and c.is_public));
