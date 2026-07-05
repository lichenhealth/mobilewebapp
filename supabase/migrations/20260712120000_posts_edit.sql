-- =============================================================================
-- Post editing — authors may update and delete their own posts.
--
-- NOT auto-applied. Run in the Supabase SQL editor. Idempotent.
--
-- Powers host event editing (Compose edit mode) and "Cancel event" on event
-- pages. Until now posts had read+insert policies only, so even the author
-- couldn't change a typo. Events already had creator update/delete policies
-- (20260705120000) — this brings posts to parity.
-- =============================================================================

drop policy if exists "posts: update own" on public.posts;
create policy "posts: update own" on public.posts
  for update to authenticated
  using (author_id = auth.uid())
  with check (author_id = auth.uid());

drop policy if exists "posts: delete own" on public.posts;
create policy "posts: delete own" on public.posts
  for delete to authenticated
  using (author_id = auth.uid());
