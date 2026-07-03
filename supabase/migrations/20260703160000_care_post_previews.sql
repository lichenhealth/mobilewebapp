-- =============================================================================
-- Care posts: store resolved link previews.
--
-- NOT auto-applied. Run in the Supabase SQL editor, then refresh the init.sql
-- baseline with pg_dump. Idempotent.
--
-- Links pasted into a post body are auto-detected and resolved to a preview at
-- COMPOSE time (YouTube id parsed client-side; other links via the link-preview
-- edge function). The resolved metadata is stored here so viewers — including
-- the patient reading later — never re-fetch. No RLS change: same row, same
-- policies as the rest of care_posts.
--
-- Shape: jsonb array of
--   { url, kind:'youtube'|'link', videoId?, title?, description?, image?, siteName? }
-- =============================================================================

alter table public.care_posts
  add column if not exists previews jsonb not null default '[]'::jsonb;
