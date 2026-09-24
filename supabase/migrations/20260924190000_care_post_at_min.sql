-- A care-plan entry can carry a TIME now (founder 2026-09-24: "click on an
-- hour to add something, which allows you to time stamp the item in on the
-- care plan"). Minutes since midnight, the reminders idiom — null = the
-- existing all-day behavior, so every historical entry is unchanged.
alter table public.care_posts add column if not exists at_min smallint
  check (at_min is null or (at_min >= 0 and at_min < 1440));
