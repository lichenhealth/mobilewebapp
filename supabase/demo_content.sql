-- DEMO CONTENT (2026-07-24): test posts that follow the real data
-- architecture exactly — real rows in public.posts, authored by Claude's
-- member account, every mode the Marketplace/Work/Art/Food surfaces know.
-- Every row carries details.demo = true, so the whole pack wipes with:
--
--   delete from public.posts where details->>'demo' = 'true';
--
-- Inserting the ISO rows LAST lets the matcher trigger prove itself against
-- the offers (bells land on the author — Claude). Run as one query.

insert into public.posts
  (author_id, title, body, content_type, is_public, to_mycelium,
   audience_space_ids, visibility, service_areas, service_area, details)
values
-- ── Marketplace: one of every offer mode ────────────────────────────────────
('85c04e7a-5a47-4c0e-85a4-0b35ff67a682',
 'Cedar dining table, seats eight',
 'Hand-finished cedar table from a storm-felled tree. Solid, heavy, ready for twenty more years of dinners. Gifting it to whoever needs a bigger table — demo listing.',
 'actionable', true, false, '{}', 'public', '{marketplace}', 'marketplace',
 '{"demo": true, "mode": "gift", "location": "Bailey, Colorado", "media": [{"type": "photo", "url": "https://picsum.photos/seed/lichen-table/800/800"}]}'::jsonb),

('85c04e7a-5a47-4c0e-85a4-0b35ff67a682',
 'Garden starts — tomatoes, kale, squash',
 'Extra seedlings from the greenhouse, hardened off and ready to plant. Trade for eggs, honey, or a hand weeding — demo listing.',
 'actionable', true, false, '{}', 'public', '{marketplace}', 'marketplace',
 '{"demo": true, "mode": "trade", "location": "Pine, Colorado", "media": [{"type": "photo", "url": "https://picsum.photos/seed/lichen-starts/800/800"}]}'::jsonb),

('85c04e7a-5a47-4c0e-85a4-0b35ff67a682',
 'Pickup truck by the day',
 'Reliable half-ton for dump runs, moves, and lumber hauls. You fuel it — demo listing.',
 'actionable', true, false, '{}', 'public', '{marketplace}', 'marketplace',
 '{"demo": true, "mode": "rent", "price": "$20/day", "location": "Bailey, Colorado", "media": [{"type": "photo", "url": "https://picsum.photos/seed/lichen-truck/800/800"}]}'::jsonb),

('85c04e7a-5a47-4c0e-85a4-0b35ff67a682',
 'Chainsaw to lend',
 'Sharp chain, fresh bar oil. Happy to lend for a weekend of firewood work — demo listing.',
 'actionable', true, false, '{}', 'public', '{marketplace}', 'marketplace',
 '{"demo": true, "mode": "lend", "media": [{"type": "photo", "url": "https://picsum.photos/seed/lichen-saw/800/800"}]}'::jsonb),

('85c04e7a-5a47-4c0e-85a4-0b35ff67a682',
 'Looking to borrow a cider press',
 'The apples came in all at once. One weekend in October would do it — demo listing.',
 'actionable', true, false, '{}', 'public', '{marketplace}', 'marketplace',
 '{"demo": true, "mode": "borrow"}'::jsonb),

('85c04e7a-5a47-4c0e-85a4-0b35ff67a682',
 'Hand-thrown mugs, set of four',
 'Wheel-thrown stoneware, food-safe glaze in juniper green — demo listing.',
 'actionable', true, false, '{}', 'public', '{marketplace}', 'marketplace',
 '{"demo": true, "mode": "sale", "price": "$40", "media": [{"type": "photo", "url": "https://picsum.photos/seed/lichen-mugs/800/800"}]}'::jsonb),

('85c04e7a-5a47-4c0e-85a4-0b35ff67a682',
 'Sixty-minute bodywork session',
 'Deep tissue and craniosacral, sliding scale so money never blocks care — demo listing.',
 'actionable', true, false, '{}', 'public', '{marketplace}', 'marketplace',
 '{"demo": true, "mode": "sliding", "price": "$20–$60", "location": "Conifer, Colorado"}'::jsonb),

-- The entrusted offering: Lichen* routes it where it's needed most.
('85c04e7a-5a47-4c0e-85a4-0b35ff67a682',
 'Winter coats, kids sizes 6–10',
 'Three warm coats outgrown in one season. Entrusted to Lichen to route to whoever needs them most — demo listing.',
 'actionable', true, false, '{}', 'public', '{marketplace}', 'marketplace',
 '{"demo": true, "mode": "gift", "allocation": "lichen", "media": [{"type": "photo", "url": "https://picsum.photos/seed/lichen-coats/800/800"}]}'::jsonb),

-- ── Work: the job-board rows ────────────────────────────────────────────────
('85c04e7a-5a47-4c0e-85a4-0b35ff67a682',
 'Carpenter wanted — timber-frame barn repair',
 'Two weeks of joinery on a 1920s barn. Experience with mortise-and-tenon a plus; tools provided — demo listing.',
 'actionable', true, false, '{}', 'public', '{work}', 'work',
 '{"demo": true, "mode": "sale", "price": "$30/hr", "location": "Fairplay, Colorado", "media": [{"type": "photo", "url": "https://picsum.photos/seed/lichen-barn/800/800"}]}'::jsonb),

('85c04e7a-5a47-4c0e-85a4-0b35ff67a682',
 'Offering: garden help through September',
 'Strong back, good with irrigation lines. Trade for produce or seed stock — demo listing.',
 'actionable', true, false, '{}', 'public', '{work}', 'work',
 '{"demo": true, "mode": "trade", "location": "Bailey, Colorado"}'::jsonb),

('85c04e7a-5a47-4c0e-85a4-0b35ff67a682',
 'Herbalism apprenticeship, one season',
 'Learn the harvest calendar, tincturing, and the drying shed. No experience needed, just consistency — demo listing.',
 'actionable', true, false, '{}', 'public', '{work}', 'work',
 '{"demo": true, "mode": "gift", "location": "Shawnee, Colorado"}'::jsonb),

-- ── Art & Food: light those sections up ─────────────────────────────────────
('85c04e7a-5a47-4c0e-85a4-0b35ff67a682',
 'Aspen grove, oil on panel',
 'Painted on-site over three October mornings — demo piece.',
 'creative', true, false, '{}', 'public', '{art}', 'art',
 '{"demo": true, "mode": "sale", "price": "$180", "media": [{"type": "photo", "url": "https://picsum.photos/seed/lichen-aspen/800/800"}]}'::jsonb),

('85c04e7a-5a47-4c0e-85a4-0b35ff67a682',
 'Sourdough share — two loaves every Sunday',
 'Wood-fired country loaves from a nine-year starter. First come, first fed — demo listing.',
 'social', true, false, '{}', 'public', '{food}', 'food',
 '{"demo": true, "mode": "gift", "location": "Bailey, Colorado", "media": [{"type": "photo", "url": "https://picsum.photos/seed/lichen-bread/800/800"}]}'::jsonb),

-- ── ISO rows LAST: the matcher scans them against the offers above ──────────
('85c04e7a-5a47-4c0e-85a4-0b35ff67a682',
 'In search of a dining table',
 'Family of six squeezing around a card table. A real dining table would change our evenings — demo ask.',
 'actionable', true, false, '{}', 'public', '{marketplace}', 'marketplace',
 '{"demo": true, "mode": "iso"}'::jsonb),

('85c04e7a-5a47-4c0e-85a4-0b35ff67a682',
 'In search of winter coats for kids',
 'Two growing kids, sizes 7 and 9, before the first snow — demo ask.',
 'actionable', true, false, '{}', 'public', '{marketplace}', 'marketplace',
 '{"demo": true, "mode": "iso"}'::jsonb);
