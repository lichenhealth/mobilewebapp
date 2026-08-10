-- Remove the old marketing-site essay/bookshelf import from the live Library
-- (founder 2026-08-10: replacing with better-curated content; full content
-- backed up first to archive/lichen_essays_and_bookshelf_backup_2026-08-10.json).
-- Scope: exactly the 17 posts in "The Lichen essays" (11) and "The Lichen
-- bookshelf" (6) collections, owned by the founder account — NOT the other
-- member's 24 separate Akashic Records library/courses posts, untouched.

delete from public.collections
where id in ('02aa2dee-f955-54e9-879e-2542a7552e5f', 'ea4ae9d1-a848-548e-83c6-7022cf81ea54');
-- cascades collection_items, collection_enrollments, collection_progress,
-- collection_suggestions for these two collections.

delete from public.posts
where id in (
  '73a02456-5ae4-53e2-91fc-a823730322c3', 'a608f350-bbd8-5410-b945-9cf3136b7d25',
  '946c1911-bd9a-5c51-b313-b993538be73b', '7d55c163-f273-50b8-9a89-66eb06112469',
  '48722e7e-b358-594f-9951-4370f82d555d', 'dda37ba8-3e35-53d0-846d-67cb4b9e75a9',
  '20edcbb7-a0b3-5a9c-a1e1-ed0537d22bc4', '4acf5c4f-9f80-52ee-a88d-59a50e2363f4',
  'c98fadc7-cbd0-5f86-93f2-1a7dc5a9cf07', '467b134d-2d60-582e-83ed-a6ec14e33e72',
  '7ab21803-0987-5b19-839c-5c78a9cd9db7',
  '5c28dd64-7d3b-5253-98c9-350d3b217de2', '6d20283e-3361-5aad-9ddf-c42495476dfc',
  '137a9542-dfe0-5f92-a294-aa17808412a4', 'ed398f67-6edb-5d97-9986-6ff3fd4b6362',
  'd6dcfa95-d22b-506b-a34c-d4d612e642dd', '8c2b3cfa-a689-5a0a-8194-f5740c6b261d'
);
