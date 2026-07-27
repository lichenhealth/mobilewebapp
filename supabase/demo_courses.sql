-- DEMO COURSES (2026-07-26): two example courses owned by the LICHEN
-- organization (space-owned — duty-holders organize them together), so the
-- founder can feel the course room: modules, lesson order, offering chips,
-- the learner view (sign in as Rosa to see it as a participant).
--
--   Course 1 "Growing With Lichen"  — fully built: 6 lessons in 2 modules
--   Course 2 "Teaching on Lichen"   — empty: build it from scratch
--
-- Lesson posts are authored by Claude and carry details.demo = true (the
-- example bubble). Wipe block at the bottom.

-- ── 1. Six lesson posts (Claude, courses area, educational) ─────────────────
insert into public.posts
  (id, author_id, title, body, content_type, is_public, to_mycelium,
   audience_space_ids, visibility, service_areas, service_area, details)
values
  ('de300004-0000-4000-a000-000000000001', '85c04e7a-5a47-4c0e-85a4-0b35ff67a682',
   'Welcome — what Lichen is for',
   'A short welcome: why this platform exists, and how to move through it slowly. Healing the world starts with ourselves — demo lesson.',
   'educational', true, false, '{}', 'public', '{courses}', 'courses', '{"demo": true}'::jsonb),
  ('de300004-0000-4000-a000-000000000002', '85c04e7a-5a47-4c0e-85a4-0b35ff67a682',
   'Your web: weaving the people you trust',
   'How the mycelium works: weave people in, keep trust private, let recommendations flow through relationships — demo lesson.',
   'educational', true, false, '{}', 'public', '{courses}', 'courses', '{"demo": true}'::jsonb),
  ('de300004-0000-4000-a000-000000000003', '85c04e7a-5a47-4c0e-85a4-0b35ff67a682',
   'Presence: candles, and being around',
   'The presence panel, the candle in the top bar, and why presence is a gift, not a status — demo lesson.',
   'educational', true, false, '{}', 'public', '{courses}', 'courses', '{"demo": true}'::jsonb),
  ('de300004-0000-4000-a000-000000000004', '85c04e7a-5a47-4c0e-85a4-0b35ff67a682',
   'The marketplace: gift, trade, and Lichen*',
   'Every offer mode, and what it means to entrust an offering to the Lichen Economy Algorithm — demo lesson.',
   'educational', true, false, '{}', 'public', '{courses}', 'courses', '{"demo": true}'::jsonb),
  ('de300004-0000-4000-a000-000000000005', '85c04e7a-5a47-4c0e-85a4-0b35ff67a682',
   'Current-cy: value that remembers',
   'The dollar-pegged ledger, why balances are private, and how contribution comes back around — demo lesson.',
   'educational', true, false, '{}', 'public', '{courses}', 'courses', '{"demo": true}'::jsonb),
  ('de300004-0000-4000-a000-000000000006', '85c04e7a-5a47-4c0e-85a4-0b35ff67a682',
   'Care teams and the Concierge',
   'Assembling care by mutual consent, the Web of Wellbeing, and reaching a rested human when it''s urgent — demo lesson.',
   'educational', true, false, '{}', 'public', '{courses}', 'courses', '{"demo": true}'::jsonb)
on conflict do nothing;

-- ── 2. The two courses, owned by the LICHEN organization ────────────────────
-- (space resolved as the org the founder super-admins — dodges the known
-- duplicate 'Lichen' org row)
with lichen_org as (
  select s.id from public.spaces s
  join public.space_members m on m.space_id = s.id
  where s.name = 'Lichen' and s.kind = 'organization'
    and m.profile_id = '1c01a063-5b05-41bb-ad61-916d7e454dbf'
    and m.role = 'super_admin'
  limit 1
)
insert into public.collections (id, owner_id, name, description, is_public, kind, space_id, details)
select v.id, v.owner_id, v.name, v.description, v.is_public, v.kind, lichen_org.id, v.details
from lichen_org, (values
  ('de300005-0000-4000-a000-000000000001'::uuid,
   '1c01a063-5b05-41bb-ad61-916d7e454dbf'::uuid,
   'Growing With Lichen',
   'An example course, fully built: two modules, six lessons — see how the course room feels, then make it yours.',
   true, 'course',
   '{"level": "Intro", "format": "Self-paced", "length": "2 modules · 6 lessons", "price": "Gift",
     "modules": [
       {"title": "Module 1 — Arriving", "ids": ["de300004-0000-4000-a000-000000000001", "de300004-0000-4000-a000-000000000002", "de300004-0000-4000-a000-000000000003"]},
       {"title": "Module 2 — The Economy", "ids": ["de300004-0000-4000-a000-000000000004", "de300004-0000-4000-a000-000000000005", "de300004-0000-4000-a000-000000000006"]}
     ]}'::jsonb),
  ('de300005-0000-4000-a000-000000000002'::uuid,
   '1c01a063-5b05-41bb-ad61-916d7e454dbf'::uuid,
   'Teaching on Lichen',
   'An empty example course — add lessons, name modules, create the circle: build it from nothing and feel the flow.',
   false, 'course', '{}'::jsonb)
) as v(id, owner_id, name, description, is_public, kind, details)
on conflict (id) do nothing;

-- ── 3. Lessons into course 1, in order ──────────────────────────────────────
insert into public.collection_items (collection_id, target_type, target_id, position)
select 'de300005-0000-4000-a000-000000000001', 'post', v.pid, v.pos
from (values
  ('de300004-0000-4000-a000-000000000001'::uuid, 0),
  ('de300004-0000-4000-a000-000000000002'::uuid, 1),
  ('de300004-0000-4000-a000-000000000003'::uuid, 2),
  ('de300004-0000-4000-a000-000000000004'::uuid, 3),
  ('de300004-0000-4000-a000-000000000005'::uuid, 4),
  ('de300004-0000-4000-a000-000000000006'::uuid, 5)
) as v(pid, pos)
on conflict do nothing;

-- ════════════════════════════════════════════════════════════════════════════
-- WIPE (later):
--   delete from public.collections where id::text like 'de300005-%';
--   delete from public.posts where id::text like 'de300004-%';
-- ════════════════════════════════════════════════════════════════════════════
