-- Claude's reply should appear in the feed without a manual refresh, same
-- as chat_messages already does.
alter publication supabase_realtime add table public.assistant_feed_posts;
