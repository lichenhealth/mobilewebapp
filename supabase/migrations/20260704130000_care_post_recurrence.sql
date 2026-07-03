-- =============================================================================
-- Care posts (KOC): Gmail-style scheduling recurrence.
--
-- NOT auto-applied. Run in the Supabase SQL editor, then refresh the init.sql
-- baseline with pg_dump. Idempotent.
--
-- A KOC post can now repeat. `recurrence` (null = a plain single day / date range,
-- exactly as before → fully back-compat) holds an RRULE-lite spec:
--   { freq:'daily'|'weekly'|'monthly'|'yearly', interval:int,
--     byday?:int[],                 -- weekly, 0=Mon..6=Sun (multi = "Fri & Sat")
--     monthMode?:'date'|'weekday',  -- monthly: on the Nth | on the "2nd Tuesday"
--     end:{type:'never'} | {type:'until',date} | {type:'count',n} }
-- start_date is the anchor (DTSTART). end_date stays the range end for
-- non-recurring posts; for a recurring post it's null (occurrence is decided by
-- the recurrence spec, evaluated client-side per visible day).
-- =============================================================================

alter table public.care_posts
  add column if not exists recurrence jsonb;

-- Relax the kind-shape CHECK: KOC end_date may be null WHEN recurrence is set.
alter table public.care_posts drop constraint if exists care_posts_kind_shape;
alter table public.care_posts add constraint care_posts_kind_shape check (
  (kind = 'wow' and score is not null and start_date is null and end_date is null and recurrence is null)
  or
  (kind = 'koc' and score is null and start_date is not null and cardinality(dimensions) = 0
    and (
      (recurrence is null and end_date is not null and end_date >= start_date)  -- plain day/range
      or
      (recurrence is not null and (end_date is null or end_date >= start_date)) -- repeating
    ))
);
