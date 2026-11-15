-- Delete a conversation with the assistant (founder 2026-11-15: "lets create
-- the capacity to delete old chats"). A member may delete their OWN rows —
-- both sides of their own 1:1 relationship with Claude, which are theirs by
-- construction (owner-only reads). A fellow steward's rows in a shared space
-- build thread stay theirs: profile_id = auth.uid() only.
drop policy if exists "own feed delete" on public.assistant_feed_posts;
create policy "own feed delete" on public.assistant_feed_posts
  for delete to authenticated using (profile_id = auth.uid());
