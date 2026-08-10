-- DEMO CAST (2026-07-25): example MEMBERS, SPACES, and EVENTS that follow the
-- real architecture end-to-end — real auth users (you can SIGN IN as any of
-- them: password  lichen-demo-2026  — useful for testing join requests,
-- suggestions, chats, RSVPs from the other side), real spaces with the
-- creator-becomes-super-admin trigger, real events linked to posts.
--
-- Every id begins with de3000… so the whole cast wipes cleanly (block at the
-- bottom). All posts carry details.demo = true (the example bubble).
-- Run AFTER the demo_content.sql pack (independent, but same spirit).
-- ALSO: sets Claude's avatar to the brain mark (deployed at
-- https://lichen.healthcare/claude-avatar.svg — run ~2 min after the deploy).

-- ⚠ GOTCHA (found 2026-08-04, doesn't affect this already-run batch — see
-- marketing_demo.sql for the fix): auth.users.confirmation_token/
-- recovery_token/email_change/email_change_token_new have no column
-- default, so a plain insert like the one below leaves them NULL, and
-- current GoTrue can't log in an account with NULL there (500 "Database
-- error querying schema"). This batch's rows work today only because a
-- later Supabase platform-side auth migration backfilled existing rows —
-- that backfill won't apply to any NEW insert. If you ever re-run or copy
-- this pattern, explicitly set those four columns to ''.
-- ── 1. Three example members (auth.users → trigger creates profiles) ────────
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', 'de300001-0000-4000-a000-000000000001',
   'authenticated', 'authenticated', 'rosa.example@demo.lichen.health',
   extensions.crypt('lichen-demo-2026', extensions.gen_salt('bf')), now(),
   '{"provider": "email", "providers": ["email"]}', '{"full_name": "Rosa Vega"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'de300001-0000-4000-a000-000000000002',
   'authenticated', 'authenticated', 'sam.example@demo.lichen.health',
   extensions.crypt('lichen-demo-2026', extensions.gen_salt('bf')), now(),
   '{"provider": "email", "providers": ["email"]}', '{"full_name": "Sam Okafor"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'de300001-0000-4000-a000-000000000003',
   'authenticated', 'authenticated', 'june.example@demo.lichen.health',
   extensions.crypt('lichen-demo-2026', extensions.gen_salt('bf')), now(),
   '{"provider": "email", "providers": ["email"]}', '{"full_name": "June Park"}', now(), now())
on conflict (id) do nothing;

insert into auth.identities
  (id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), u.id::text, u.id,
       jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
       'email', now(), now(), now()
from auth.users u
where u.id in ('de300001-0000-4000-a000-000000000001',
               'de300001-0000-4000-a000-000000000002',
               'de300001-0000-4000-a000-000000000003')
  and not exists (select 1 from auth.identities i where i.user_id = u.id);

-- Flesh out their profiles (compose_full_name recomposes from first/last).
update public.profiles set
  first_name = 'Rosa', last_name = 'Vega',
  headline = 'Herbalist · example member',
  bio = 'An example member, here to show how Lichen works. Rosa keeps the tincture shelf stocked and teaches herb walks.',
  onboarded = true
where id = 'de300001-0000-4000-a000-000000000001';
update public.profiles set
  first_name = 'Sam', last_name = 'Okafor',
  headline = 'Carpenter · example member',
  bio = 'An example member, here to show how Lichen works. Sam builds with reclaimed timber and lends tools freely.',
  onboarded = true
where id = 'de300001-0000-4000-a000-000000000002';
update public.profiles set
  first_name = 'June', last_name = 'Park',
  headline = 'Farmer · example member',
  bio = 'An example member, here to show how Lichen works. June runs the vegetable rows at River & Root Farm.',
  onboarded = true
where id = 'de300001-0000-4000-a000-000000000003';

-- Memberships so signing in as them never hits the paywall.
insert into public.subscriptions (profile_id, tier, source, status, current_period_end)
values
  ('de300001-0000-4000-a000-000000000001', 'concierge', 'gift', 'active', now() + interval '3 months'),
  ('de300001-0000-4000-a000-000000000002', 'concierge', 'gift', 'active', now() + interval '3 months'),
  ('de300001-0000-4000-a000-000000000003', 'concierge', 'gift', 'active', now() + interval '3 months')
on conflict (profile_id) do nothing;

-- ── 2. Example spaces (creator becomes super_admin via trigger) ─────────────
insert into public.spaces (id, name, kind, description, created_by, parent_space_id)
values
  ('de300002-0000-4000-a000-000000000001', 'Pine Valley Grange', 'community',
   'An example community, here to show how Lichen works — potlucks, seed swaps, and a shared tool library.',
   'de300001-0000-4000-a000-000000000003', null),
  ('de300002-0000-4000-a000-000000000002', 'The Trail Crew', 'group',
   'An example group nested in Pine Valley Grange — hands that keep the paths clear.',
   'de300001-0000-4000-a000-000000000002', 'de300002-0000-4000-a000-000000000001'),
  ('de300002-0000-4000-a000-000000000003', 'River & Root Farm', 'organization',
   'An example organization, here to show how Lichen works — a small organic farm with weekly shares.',
   'de300001-0000-4000-a000-000000000003', null)
on conflict (id) do nothing;

-- Cross-membership: the cast belongs to each other's spaces.
insert into public.space_members (space_id, profile_id, role)
values
  ('de300002-0000-4000-a000-000000000001', 'de300001-0000-4000-a000-000000000001', 'member'),
  ('de300002-0000-4000-a000-000000000001', 'de300001-0000-4000-a000-000000000002', 'admin'),
  ('de300002-0000-4000-a000-000000000002', 'de300001-0000-4000-a000-000000000003', 'member'),
  ('de300002-0000-4000-a000-000000000003', 'de300001-0000-4000-a000-000000000001', 'member'),
  ('de300002-0000-4000-a000-000000000003', 'de300001-0000-4000-a000-000000000002', 'member')
on conflict do nothing;

-- ── 3. Posts from many directions (people AND spaces as authors) ────────────
insert into public.posts
  (author_id, author_space_id, title, body, content_type, is_public, to_mycelium,
   audience_space_ids, visibility, service_areas, service_area, details)
values
-- Rosa: a Library piece + a sliding-scale offer
('de300001-0000-4000-a000-000000000001', null,
 'A field guide to roadside medicine',
 'Yarrow for the cut, plantain for the sting, mullein for the cough — the pharmacy grows along every path here. Notes from ten seasons of gathering — demo piece.',
 'educational', true, false, '{}', 'public', '{library}', 'library',
 '{"demo": true, "media": [{"type": "photo", "url": "https://picsum.photos/seed/lichen-herbs/800/800"}]}'::jsonb),
('de300001-0000-4000-a000-000000000001', null,
 'Elderberry syrup, quart jars',
 'This year''s batch, slow-simmered with local honey. Sliding scale so it reaches every shelf that needs it — demo listing.',
 'actionable', true, false, '{}', 'public', '{marketplace}', 'marketplace',
 '{"demo": true, "mode": "sliding", "price": "$10–$25", "media": [{"type": "photo", "url": "https://picsum.photos/seed/lichen-syrup/800/800"}]}'::jsonb),
-- Sam: a Work offer + an Art piece
('de300001-0000-4000-a000-000000000002', null,
 'Finish carpentry, two open weekends',
 'Shelving, trim, small built-ins. Reclaimed timber preferred — demo listing.',
 'actionable', true, false, '{}', 'public', '{work}', 'work',
 '{"demo": true, "mode": "sale", "price": "$40/hr", "location": "Pine, Colorado"}'::jsonb),
('de300001-0000-4000-a000-000000000002', null,
 'Walnut serving boards',
 'Offcuts too beautiful to burn, oiled and ready — demo piece.',
 'creative', true, false, '{}', 'public', '{art}', 'art',
 '{"demo": true, "mode": "trade", "media": [{"type": "photo", "url": "https://picsum.photos/seed/lichen-boards/800/800"}]}'::jsonb),
-- June: a Food share
('de300001-0000-4000-a000-000000000003', null,
 'Seconds box — tomatoes with character',
 'Split skins, odd shapes, perfect sauce. Free box on the farm stand porch every Friday — demo listing.',
 'social', true, false, '{}', 'public', '{food}', 'food',
 '{"demo": true, "mode": "gift", "location": "Bailey, Colorado", "media": [{"type": "photo", "url": "https://picsum.photos/seed/lichen-tomatoes/800/800"}]}'::jsonb),
-- The GRANGE speaks as a space
('de300001-0000-4000-a000-000000000003', 'de300002-0000-4000-a000-000000000001',
 'The tool library is open Saturdays',
 'The Grange''s shared tool wall — drills, ladders, canning rigs — checks out Saturday mornings. Bring things back sharp — demo post.',
 'social', true, false, '{}', 'public', '{marketplace}', 'marketplace',
 '{"demo": true, "mode": "lend"}'::jsonb),
-- The FARM speaks as an organization
('de300001-0000-4000-a000-000000000003', 'de300002-0000-4000-a000-000000000003',
 'Weekly farm shares, half and full',
 'Twenty weeks of vegetables, herbs, and the occasional surprise melon. Two sliding-scale shares held for neighbors who need them — demo listing.',
 'actionable', true, false, '{}', 'public', '{marketplace,food}', 'marketplace',
 '{"demo": true, "mode": "sliding", "price": "$18–$35/week", "media": [{"type": "photo", "url": "https://picsum.photos/seed/lichen-csa/800/800"}]}'::jsonb)
on conflict do nothing;

-- ── 4. Example EVENTS (real events rows + linked posts → feed, pages, RSVP) ─
insert into public.events
  (id, creator_id, owner_profile_id, owner_space_id, title, description, location,
   start_date, end_date, all_day, start_min, end_min)
values
  ('de300003-0000-4000-a000-000000000001',
   'de300001-0000-4000-a000-000000000003', null, 'de300002-0000-4000-a000-000000000001',
   'Potluck & seed swap', 'Bring a dish and the seeds you saved — the Grange table has room for both.',
   'Pine Valley Grange Hall', current_date + 5, current_date + 5, false, 1020, 1200),
  ('de300003-0000-4000-a000-000000000002',
   'de300001-0000-4000-a000-000000000002', null, 'de300002-0000-4000-a000-000000000002',
   'Riverbank trail day', 'Loppers, gloves, and good company — we clear the flood debris before fall.',
   'River trailhead', current_date + 9, current_date + 9, false, 540, 780),
  ('de300003-0000-4000-a000-000000000003',
   'de300001-0000-4000-a000-000000000001', 'de300001-0000-4000-a000-000000000001', null,
   'Herb walk with Rosa', 'Two slow miles, twelve plants, all of them medicine.',
   'Meet at the Grange porch', current_date + 12, current_date + 12, false, 600, 720)
on conflict (id) do nothing;

insert into public.posts
  (author_id, author_space_id, title, body, content_type, is_public, to_mycelium,
   audience_space_ids, visibility, service_areas, service_area,
   event_category, event_mode, linked_event_id, details)
values
('de300001-0000-4000-a000-000000000003', 'de300002-0000-4000-a000-000000000001',
 'Potluck & seed swap',
 'Bring a dish and the seeds you saved — the Grange table has room for both.',
 'actionable', true, false, '{}', 'public', '{events}', 'events',
 'social', 'free', 'de300003-0000-4000-a000-000000000001',
 '{"demo": true, "media": [{"type": "photo", "url": "https://picsum.photos/seed/lichen-potluck/800/800"}]}'::jsonb),
('de300001-0000-4000-a000-000000000002', 'de300002-0000-4000-a000-000000000002',
 'Riverbank trail day',
 'Loppers, gloves, and good company — we clear the flood debris before fall.',
 'actionable', true, false, '{}', 'public', '{events}', 'events',
 'work_charity', 'free', 'de300003-0000-4000-a000-000000000002',
 '{"demo": true, "media": [{"type": "photo", "url": "https://picsum.photos/seed/lichen-trailday/800/800"}]}'::jsonb),
('de300001-0000-4000-a000-000000000001', null,
 'Herb walk with Rosa',
 'Two slow miles, twelve plants, all of them medicine.',
 'actionable', true, false, '{}', 'public', '{events}', 'events',
 'learning', 'free', 'de300003-0000-4000-a000-000000000003',
 '{"demo": true, "media": [{"type": "photo", "url": "https://picsum.photos/seed/lichen-herbwalk/800/800"}]}'::jsonb)
on conflict do nothing;

-- ── 5. Claude's avatar: the brain mark ──────────────────────────────────────
update public.profiles
set avatar_url = 'https://lichen.healthcare/claude-avatar.svg'
where id = '85c04e7a-5a47-4c0e-85a4-0b35ff67a682';

-- ════════════════════════════════════════════════════════════════════════════
-- WIPE (run later, when real content replaces the examples):
--   delete from public.posts  where details->>'demo' = 'true';
--   delete from public.events where id::text like 'de300003-%';
--   delete from public.spaces where id::text like 'de300002-%';
--   delete from auth.users    where id::text like 'de300001-%';
-- (auth.users cascades profiles/subscriptions; spaces cascade members/chats.)
-- ════════════════════════════════════════════════════════════════════════════
