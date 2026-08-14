-- WORDS WITHOUT SCORES (founder 2026-08-14): the self-evaluation is "in your
-- own words" with an OPTIONAL self-score — but care_posts_kind_shape required
-- every wow post to carry a score, so a words-only entry couldn't exist.
-- Relax just that arm: a wow post may hold words, a score, or both (the radar
-- already skips score-less posts; nothing else reads score as required).
-- The koc arm is unchanged.

alter table public.care_posts
  drop constraint if exists care_posts_kind_shape,
  add constraint care_posts_kind_shape check (
    (kind = 'wow' and start_date is null and end_date is null and recurrence is null)
    or (kind = 'koc' and score is null and start_date is not null and cardinality(dimensions) = 0
        and ((recurrence is null and end_date is not null and end_date >= start_date)
          or (recurrence is not null and (end_date is null or end_date >= start_date))))
  );
