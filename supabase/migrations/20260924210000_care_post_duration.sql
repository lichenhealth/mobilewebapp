-- A timed care-plan entry can carry a DURATION (founder 2026-09-24: "you
-- can select an hour or 45 minutes, etc - like you do on google cal").
-- Minutes; null = no stated length (a point in time), the existing shape.
alter table public.care_posts add column if not exists duration_min smallint
  check (duration_min is null or (duration_min > 0 and duration_min <= 1440));
