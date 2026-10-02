-- ONE-TIME LINES CARRY A DATE (founder 2026-10-02: "add 1 time to the
-- expenses list, and have the capacity to enter the date, so it gets
-- nested into that month and that year"): a dated one-time line counts in
-- the Month/Year view holding its date; undated one-time lines (legacy
-- rows + bolt-added listings, the standing procure list) show in every
-- view. Additive, nullable — nothing existing changes meaning.

alter table public.budget_items
  add column if not exists on_date date;
