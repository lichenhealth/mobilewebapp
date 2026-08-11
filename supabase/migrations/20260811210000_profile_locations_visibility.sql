-- Per-address visibility for Goods & Services addresses (founder
-- 2026-08-11: "a 'show on maps' and a 'show on profile' option for each
-- one"). Both default on — these addresses exist to be found — and each
-- can be switched off independently.

alter table profile_locations
  add column show_on_maps boolean not null default true,
  add column show_on_profile boolean not null default true;
