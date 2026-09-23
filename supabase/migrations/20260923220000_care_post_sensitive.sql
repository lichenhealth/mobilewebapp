-- The sensitivity MARK, split from the AI hold-back (founder 2026-09-23:
-- "Omit this content from AI" and "Mark as sensitive financial, and/or
-- medical information... maybe we set it up now and figure out how we treat
-- it differently, later"). ai_omit stays the ENFORCED flag every assistant
-- path filters on; sensitive is a label the entry wears — no machinery
-- attached yet, deliberately.
alter table public.care_posts add column if not exists sensitive boolean not null default false;
