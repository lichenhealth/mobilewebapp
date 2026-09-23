-- Care-plan entries get a TITLE (founder 2026-09-23, building the KOC entry
-- UI from the marketing mocks: every plan card leads with the name of the
-- thing — "Trauma-informed, psilocybin-assisted therapy", "Understanding
-- Trauma & the Body"). Nullable; WOW entries and all history stay untitled.
alter table public.care_posts add column if not exists title text;

-- A titled entry is real content on its own (the card can be a pure
-- reference: title + link + schedule, no prose).
alter table public.care_posts drop constraint if exists care_posts_nonempty;
alter table public.care_posts add constraint care_posts_nonempty check (
  length(btrim(body)) > 0
  or jsonb_array_length(attachments) > 0
  or jsonb_array_length(links) > 0
  or (kind = 'wow' and score is not null)
  or length(btrim(coalesce(title, ''))) > 0
);
