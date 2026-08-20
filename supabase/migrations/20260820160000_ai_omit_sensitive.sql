-- OMIT FROM AI — SENSITIVE (founder 2026-08-20): "if someone wants to import
-- a cancer scan, they can say 'Omit from Ai — sensitive medical information'
-- or '…sensitive financial information' when inputting information. That way
-- the person can still have the details, but it isn't in the collective Ai
-- system of Lichen."
--
-- Two layers, deliberately different:
--  1. The SECTION switch (assistant_consent, scope 'concierge') — AI on or
--     off for this whole part of someone's life. Already built.
--  2. THIS: a per-ENTRY omission carrying its REASON, chosen at the moment
--     of writing. The member keeps every detail; no assistant ever reads it.
--
-- A reason, not a boolean, because the two the founder named are the ones
-- that matter and the card should be able to say WHICH promise it's keeping.
alter table public.care_posts
  add column if not exists ai_omit text;
alter table public.care_posts drop constraint if exists care_posts_ai_omit_check;
alter table public.care_posts add constraint care_posts_ai_omit_check
  check (ai_omit is null or ai_omit in ('medical', 'financial', 'other'));

-- The financial health profile is sensitive financial information BY
-- DEFINITION, so it starts omitted — the "extra precaution" the founder
-- asked for. A member who wants AI help coordinating their subsidies can
-- switch it on deliberately; this is the one place on Lichen where the
-- assistant's default-on doctrine yields, on purpose.
alter table public.financial_positions
  add column if not exists ai_omit boolean not null default true;
