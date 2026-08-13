-- Assistant threads (founder 2026-08-11): the member's relationship with
-- Claude stops being one flat feed and gains rooms that MIRROR THE PLATFORM
-- — general, profile management, marketplace, and so on. Pressing AI inside
-- Marketplace lands in the marketplace room and logs there; general can
-- still draw on all of them, because they're all the member's own.
--
-- Deliberately a free text column, not an enum: threads follow sections, and
-- sections are added far more often than a migration should be needed. The
-- default keeps every existing post exactly where it is — the general room.

alter table assistant_feed_posts
  add column thread text not null default 'general';

create index assistant_feed_posts_thread_time
  on assistant_feed_posts (profile_id, thread, created_at);
