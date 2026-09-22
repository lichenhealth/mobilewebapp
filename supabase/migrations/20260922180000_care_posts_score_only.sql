-- Score-only WOW entries are real (founder 2026-09-22: going back to an
-- already-woven dimension to add just a score hit care_posts_nonempty).
-- A wow entry with a score and no words is a valid NOW-reading — the same
-- doctrine that already relaxed care_posts_kind_shape for words-only entries.
alter table public.care_posts drop constraint care_posts_nonempty;
alter table public.care_posts add constraint care_posts_nonempty
  check (
    (length(btrim(body)) > 0)
    or (jsonb_array_length(attachments) > 0)
    or (jsonb_array_length(links) > 0)
    or (kind = 'wow' and score is not null)
  );
