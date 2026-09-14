-- Suggested versus prescribed, delineated (founder 2026-09-14: "We need to
-- delineate suggested versus prescribed" — vocabulary settled the same hour
-- on the mocks as RECOMMENDED vs PRESCRIBED: "Galyn Burke prescribed this
-- course and Cherlynn Resager recommends this retreat"). A care-plan entry
-- may carry how it is held: a recommendation is worth trying, a prescription
-- is part of the plan. Optional — null is an unlabeled entry (all history,
-- and anything the author didn't frame either way).
alter table public.care_posts add column if not exists intent text
  constraint care_posts_intent_check check (intent in ('recommended','prescribed'));
