-- MARKETING DEMO CAST (2026-08-03): recreates the founder's ORIGINAL example
-- scenarios from the Figma mockups on the marketing site's /project/care,
-- /project/business and /project/platform pages — as real rows, following
-- the real architecture end-to-end, so the marketing screenshots can be
-- genuine captures of the live app instead of stale Figma composites.
--
-- Content is reproduced as written in the mockups wherever practical. One
-- deliberate substitution: the mockup's third KOC caregiver was named
-- "Galyn Burke" (the founder's own real identity) — reused here as "Jordan
-- Reyes" on a new demo account instead, to avoid a second profile carrying
-- the founder's real name. All other names/text are verbatim.
--
-- Every id begins with de3001… so this batch wipes cleanly, independent of
-- the de3000… demo_cast.sql batch:
--   delete from public.care_posts        where patient_id::text like 'de300101-0000-4000-a000-0000000000%';
--   delete from public.care_team_members where patient_id::text like 'de300101-0000-4000-a000-0000000000%';
--   delete from public.posts   where details->>'demo' = 'true' and author_id::text like 'de300101-%';
--   delete from public.events  where id::text like 'de300201-%';
--   delete from public.spaces  where id::text like 'de300301-%';
--   delete from auth.users     where id::text like 'de300101-%';
-- Sign in as any of them: password  lichen-demo-2026

-- ── 1. People ────────────────────────────────────────────────────────────
-- ⚠ GOTCHA (found 2026-08-04): auth.users.confirmation_token/recovery_token/
-- email_change/email_change_token_new have NO column default (unlike
-- phone_change/phone_change_token/etc, which default to ''), so a plain
-- insert leaves them NULL. Current GoTrue can't scan NULL into those Go
-- string fields — every login for an account created this way fails with
-- 500 "Database error querying schema" (the real error, findable only via
-- the Management API's auth_logs, is "sql: Scan error on column index 3,
-- name confirmation_token: converting NULL to string is unsupported").
-- Explicitly set them to '' below. If you're copying this pattern for a
-- future demo-user script, keep this line.
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
   confirmation_token, recovery_token, email_change, email_change_token_new)
values
  ('00000000-0000-0000-0000-000000000000', 'de300101-0000-4000-a000-000000000001',
   'authenticated', 'authenticated', 'kelly.example@demo.lichen.health',
   extensions.crypt('lichen-demo-2026', extensions.gen_salt('bf')), now(),
   '{"provider": "email", "providers": ["email"]}', '{"full_name": "Kelly Bolton"}', now(), now(),
   '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'de300101-0000-4000-a000-000000000002',
   'authenticated', 'authenticated', 'cherlynn.example@demo.lichen.health',
   extensions.crypt('lichen-demo-2026', extensions.gen_salt('bf')), now(),
   '{"provider": "email", "providers": ["email"]}', '{"full_name": "Cherlynn Resager"}', now(), now(),
   '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'de300101-0000-4000-a000-000000000003',
   'authenticated', 'authenticated', 'jordan.example@demo.lichen.health',
   extensions.crypt('lichen-demo-2026', extensions.gen_salt('bf')), now(),
   '{"provider": "email", "providers": ["email"]}', '{"full_name": "Jordan Reyes"}', now(), now(),
   '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'de300101-0000-4000-a000-000000000004',
   'authenticated', 'authenticated', 'payton.example@demo.lichen.health',
   extensions.crypt('lichen-demo-2026', extensions.gen_salt('bf')), now(),
   '{"provider": "email", "providers": ["email"]}', '{"full_name": "Payton Skawinski"}', now(), now(),
   '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'de300101-0000-4000-a000-000000000005',
   'authenticated', 'authenticated', 'mountainbeef.example@demo.lichen.health',
   extensions.crypt('lichen-demo-2026', extensions.gen_salt('bf')), now(),
   '{"provider": "email", "providers": ["email"]}', '{"full_name": "Mountain Beef Co."}', now(), now(),
   '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'de300101-0000-4000-a000-000000000006',
   'authenticated', 'authenticated', 'heroesjourney.example@demo.lichen.health',
   extensions.crypt('lichen-demo-2026', extensions.gen_salt('bf')), now(),
   '{"provider": "email", "providers": ["email"]}', '{"full_name": "Heroes Journey Center"}', now(), now(),
   '', '', '', '')
on conflict (id) do nothing;

insert into auth.identities
  (id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), u.id::text, u.id,
       jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
       'email', now(), now(), now()
from auth.users u
where u.id::text like 'de300101-0000-4000-a000-0000000000%'
  and not exists (select 1 from auth.identities i where i.user_id = u.id);

update public.profiles set first_name = 'Kelly', last_name = 'Bolton',
  headline = 'Example patient · demo member', onboarded = true,
  bio = 'An example member, here to show how Lichen''s Concierge care coordination works.'
  where id = 'de300101-0000-4000-a000-000000000001';
update public.profiles set first_name = 'Cherlynn', last_name = 'Resager', handle = 'cherlynnresager',
  headline = 'Nutrition & bodywork · demo caregiver', onboarded = true,
  bio = 'An example caregiver, here to show how a Lichen care team coordinates.'
  where id = 'de300101-0000-4000-a000-000000000002';
update public.profiles set first_name = 'Jordan', last_name = 'Reyes', handle = 'jordanreyes',
  headline = 'Somatic & meditation guide · demo caregiver', onboarded = true,
  bio = 'An example caregiver, here to show how a Lichen care team coordinates.'
  where id = 'de300101-0000-4000-a000-000000000003';
update public.profiles set first_name = 'Payton', last_name = 'Skawinski', handle = 'paytonskawinski',
  headline = 'Primary care coordination · demo caregiver', onboarded = true,
  bio = 'An example caregiver, here to show how a Lichen care team coordinates.'
  where id = 'de300101-0000-4000-a000-000000000004';
update public.profiles set first_name = 'Mountain', last_name = 'Beef Co.', handle = 'mountainbeef',
  headline = 'Grass-fed, grass-finished · demo member', onboarded = true,
  bio = 'An example member, here to show how Lichen''s Marketplace works.'
  where id = 'de300101-0000-4000-a000-000000000005';
update public.profiles set first_name = 'Heroes', last_name = 'Journey Center', handle = 'heroesjourneycenter',
  headline = 'Peer support for recovery · demo member', onboarded = true,
  bio = 'An example member, here to show how a Lichen group runs an ongoing support circle.'
  where id = 'de300101-0000-4000-a000-000000000006';

insert into public.subscriptions (profile_id, tier, source, status, current_period_end)
select id, 'concierge', 'gift', 'active', now() + interval '3 months'
from auth.users where id::text like 'de300101-0000-4000-a000-0000000000%'
on conflict (profile_id) do nothing;

-- ── 2. Spaces ────────────────────────────────────────────────────────────
insert into public.spaces (id, name, kind, description, handle, created_by, parent_space_id)
values
  ('de300301-0000-4000-a000-000000000001', 'Mons Sana', 'community',
   'An example community, here to show how Lichen works — gathering under the mountain sky.',
   'monssana', 'de300101-0000-4000-a000-000000000003', null),
  ('de300301-0000-4000-a000-000000000002', 'Support Recovery', 'group',
   'A rotating team of peer support specialists hosts a consultation group every Monday at 6:30pm MST to answer questions about the training or seek advice around how to navigate a current situation with a loved one. An example group, here to show how Lichen supports an ongoing recovery circle.',
   'supportrecovery', 'de300101-0000-4000-a000-000000000006', null)
on conflict (id) do nothing;

insert into public.space_members (space_id, profile_id, role)
values
  ('de300301-0000-4000-a000-000000000001', 'de300101-0000-4000-a000-000000000001', 'member'),
  ('de300301-0000-4000-a000-000000000002', 'de300101-0000-4000-a000-000000000001', 'member'),
  ('de300301-0000-4000-a000-000000000002', 'de300101-0000-4000-a000-000000000003', 'member')
on conflict do nothing;

-- ── 3. Events + their announcing posts ──────────────────────────────────
insert into public.events
  (id, creator_id, owner_profile_id, owner_space_id, title, description, location,
   start_date, end_date, all_day, start_min, end_min)
values
  ('de300201-0000-4000-a000-000000000001',
   'de300101-0000-4000-a000-000000000003', null, 'de300301-0000-4000-a000-000000000001',
   'Solstice Celebration',
   'Please join us as we gather to honor the sun goddess, feast, dance, and make offerings of thanks for all of the beautiful healing work that our community is doing, together. Children and dogs are welcome!',
   '29700 S Sunset Trail, Conifer, CO',
   (current_date + 18), (current_date + 18),
   false, 840, 1020)
on conflict (id) do nothing;

insert into public.posts
  (author_id, author_space_id, title, body, content_type, is_public, to_mycelium,
   audience_space_ids, visibility, service_areas, service_area,
   event_category, event_mode, linked_event_id, details)
values
  ('de300101-0000-4000-a000-000000000003', 'de300301-0000-4000-a000-000000000001',
   'Solstice Celebration',
   '@lichen-bailey-CO has generously offered to host our annual Summer Solstice Celebration! We can sleep up to 40 folks, if those from out-of-town would like to join us. For more details check out the Event page and let us know if you can join us! We''re so excited to see your radiant faces and kind hearts.',
   'actionable', true, false, '{}', 'public', '{events}', 'events',
   'social', 'free', 'de300201-0000-4000-a000-000000000001', '{"demo": true}'::jsonb),
  ('de300101-0000-4000-a000-000000000005', null,
   'It''s Beef Ordering Time!',
   'Time to order your whole, half and quarter shares of grass-fed, grass-finished beef for delivery to our Oregon and Washington State locations, or via our nation-wide shipping options. Pricing based on projected order volumes is available on our booking page. Please reach out to Mark...',
   'actionable', true, false, '{}', 'public', '{marketplace}', 'marketplace',
   null, null, null,
   '{"demo": true, "mode": "sale", "price": "Varies by share size"}'::jsonb)
on conflict do nothing;

-- ── 4. Kelly Bolton's care team + this week's KOC ───────────────────────
insert into public.care_team_members (patient_id, caregiver_id, status, initiated_by)
values
  ('de300101-0000-4000-a000-000000000001', 'de300101-0000-4000-a000-000000000002', 'pending', 'de300101-0000-4000-a000-000000000002'),
  ('de300101-0000-4000-a000-000000000001', 'de300101-0000-4000-a000-000000000003', 'pending', 'de300101-0000-4000-a000-000000000003'),
  ('de300101-0000-4000-a000-000000000001', 'de300101-0000-4000-a000-000000000004', 'pending', 'de300101-0000-4000-a000-000000000004')
on conflict do nothing;

update public.care_team_members set status = 'active', decided_at = now()
where patient_id = 'de300101-0000-4000-a000-000000000001'
  and caregiver_id in ('de300101-0000-4000-a000-000000000002',
                        'de300101-0000-4000-a000-000000000003',
                        'de300101-0000-4000-a000-000000000004');

insert into public.care_posts (patient_id, author_id, kind, body, start_date, end_date, recurrence)
values
  ('de300101-0000-4000-a000-000000000001', 'de300101-0000-4000-a000-000000000002', 'koc',
   'Green Smoothie (1x day/am)', (date_trunc('week', current_date) - interval '7 days')::date, null,
   '{"freq":"daily","interval":1,"end":{"type":"never"}}'::jsonb),
  ('de300101-0000-4000-a000-000000000001', 'de300101-0000-4000-a000-000000000002', 'koc',
   'Dynamite Supplements (DM Plus am/Tri-Mins pm)', (date_trunc('week', current_date) - interval '7 days')::date, null,
   '{"freq":"daily","interval":1,"end":{"type":"never"}}'::jsonb),
  ('de300101-0000-4000-a000-000000000001', 'de300101-0000-4000-a000-000000000002', 'koc',
   '30 minutes on the biomat at Lichen Bainbridge Island (PM, if possible)', (date_trunc('week', current_date) - interval '7 days')::date, null,
   '{"freq":"daily","interval":1,"end":{"type":"never"}}'::jsonb),
  ('de300101-0000-4000-a000-000000000001', 'de300101-0000-4000-a000-000000000003', 'koc',
   'Inner Child Meditation', (date_trunc('week', current_date) - interval '7 days')::date, null,
   '{"freq":"daily","interval":1,"end":{"type":"never"}}'::jsonb),
  ('de300101-0000-4000-a000-000000000001', 'de300101-0000-4000-a000-000000000004', 'koc',
   'Stay at 50mg Zoloft, daily', (date_trunc('week', current_date) - interval '7 days')::date, null,
   '{"freq":"daily","interval":1,"end":{"type":"never"}}'::jsonb),
  ('de300101-0000-4000-a000-000000000001', 'de300101-0000-4000-a000-000000000003', 'koc',
   'Support Recovery', date_trunc('week', current_date)::date, date_trunc('week', current_date)::date, null),
  ('de300101-0000-4000-a000-000000000001', 'de300101-0000-4000-a000-000000000004', 'koc',
   '3pm blood draw at Lynwood Office', date_trunc('week', current_date)::date, date_trunc('week', current_date)::date, null);
