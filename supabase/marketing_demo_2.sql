-- MARKETING DEMO, BATCH 2 (2026-08-04): the 4 remaining Figma composites
-- found still live on /project/care (Connect, Deliver) and /project/business
-- (Revenue Model, Land Trust) — same spirit as marketing_demo.sql, reusing
-- the same de3001... cast where the scenario already exists (Kelly Bolton's
-- care team) and adding what's new: a Current-cy grant + a bookable place.
-- Wipes with the rest of that batch (ledger_entries/chat_messages/resources
-- rows aren't id-prefixed like the others — delete by the same de300101/
-- de300301 party ids, or just leave them; they're inert without the cast).

-- ── 1. A few real messages in Kelly Bolton's already-real care-team chat ───
insert into public.chat_messages (chat_id, sender_id, body, created_at)
values
  ('75e37c0d-70d6-43f3-8f0f-ffe9b73cfa89', 'de300101-0000-4000-a000-000000000002',
   'Kelly, how are you feeling about the herbs I added to your care plan this week?', now() - interval '2 hours'),
  ('75e37c0d-70d6-43f3-8f0f-ffe9b73cfa89', 'de300101-0000-4000-a000-000000000001',
   'Better, thank you — the smoothie routine is actually sticking this time.', now() - interval '110 minutes'),
  ('75e37c0d-70d6-43f3-8f0f-ffe9b73cfa89', 'de300101-0000-4000-a000-000000000003',
   'Glad to hear it. I moved our meditation session to Thursday if that still works for you.', now() - interval '90 minutes'),
  ('75e37c0d-70d6-43f3-8f0f-ffe9b73cfa89', 'de300101-0000-4000-a000-000000000004',
   'Noted — I''ll update the calendar and let the pharmacy know about the refill.', now() - interval '85 minutes');

-- ── 2. A Current-cy grant, the "subsidy" the Revenue Model copy describes ──
insert into public.ledger_entries (to_type, to_id, amount, context, memo)
values ('profile', 'de300101-0000-4000-a000-000000000001', 150.00, 'grant',
        'Care subsidy — scholarship match toward this month''s supplements');

-- ── 3. A place with a bookable room, for the Land Trust section ───────────
insert into public.spaces (id, name, kind, description, handle, created_by)
values ('de300301-0000-4000-a000-000000000003', 'Coeur de Canoe', 'place',
        'An example retreat venue, here to show how Lichen''s Land Trust works — bookable rooms held in trust for the community that tends them.',
        'coeurdecanoe', 'de300101-0000-4000-a000-000000000003')
on conflict (id) do nothing;

insert into public.resources (space_id, name, kind, description, bookable, approval)
values ('de300301-0000-4000-a000-000000000003', 'The Journey Room', 'room',
        'A quiet room for retreats, ceremony and small gatherings — sleeps 4.', true, 'request');
