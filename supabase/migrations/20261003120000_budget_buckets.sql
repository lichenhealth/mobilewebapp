-- BUDGET BUCKETS (founder 2026-10-02: "change energy needed to Expenses and
-- Energy provided to Income and have two more sections, one for excess
-- stuff you have to give … no need for reciprocal compensation, and one
-- for 'need' — since melanie isn't making enough money, she doesn't get
-- acupuncture she needs, so she's getting sick… that wouldn't be an expense
-- because she doesn't have the funds, so it's a need").
--
-- Four buckets now name what a line IS, not just which way it flows:
--   expense — what life asks of you and you pay (incl. the procure list)
--   income  — what you provide expecting Current back
--   gift    — what you offer freely, no reciprocal compensation
--   need    — what you need but can't fund (the acupuncture case; its door
--             is "Ask the network", the gift/ISO matcher's territory)
-- `direction` stays (expense/need face out, income/gift face in) — the
-- bucket refines it. Additive: existing rows backfill from what they
-- already said (out → expense; in with ⚡0 → gift [the old "offered
-- freely"]; in with an amount → income).

alter table public.budget_items
  add column if not exists bucket text
  constraint budget_items_bucket_check
  check (bucket in ('expense', 'income', 'gift', 'need'));

update public.budget_items set bucket = case
  when direction = 'out' then 'expense'
  when coalesce(amount_cents, 0) = 0 then 'gift'
  else 'income'
end where bucket is null;

alter table public.budget_items
  alter column bucket set default 'expense',
  alter column bucket set not null;
