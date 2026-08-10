-- Demo event cards were missing real images and had a redundant "An example
-- event to try RSVP on" tacked onto every body (the EXAMPLE badge already
-- says that visually) — founder request 2026-08-10. Same picsum.photos seed
-- pattern the rest of demo_cast.sql already uses for its media.

update public.posts
set body = 'Bring a dish and the seeds you saved — the Grange table has room for both.',
    details = details || '{"media": [{"type": "photo", "url": "https://picsum.photos/seed/lichen-potluck/800/800"}]}'::jsonb
where linked_event_id = 'de300003-0000-4000-a000-000000000001';

update public.posts
set body = 'Loppers, gloves, and good company — we clear the flood debris before fall.',
    details = details || '{"media": [{"type": "photo", "url": "https://picsum.photos/seed/lichen-trailday/800/800"}]}'::jsonb
where linked_event_id = 'de300003-0000-4000-a000-000000000002';

update public.posts
set body = 'Two slow miles, twelve plants, all of them medicine.',
    details = details || '{"media": [{"type": "photo", "url": "https://picsum.photos/seed/lichen-herbwalk/800/800"}]}'::jsonb
where linked_event_id = 'de300003-0000-4000-a000-000000000003';

-- The underlying events.description isn't shown in the feed/detail view
-- (both read posts.body) but keep it in step so the seed data stays clean.
update public.events set description = 'Bring a dish and the seeds you saved — the Grange table has room for both.'
where id = 'de300003-0000-4000-a000-000000000001';
update public.events set description = 'Loppers, gloves, and good company — we clear the flood debris before fall.'
where id = 'de300003-0000-4000-a000-000000000002';
update public.events set description = 'Two slow miles, twelve plants, all of them medicine.'
where id = 'de300003-0000-4000-a000-000000000003';
