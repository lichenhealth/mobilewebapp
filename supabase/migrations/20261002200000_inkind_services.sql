-- IN-KIND DONATIONS: GOODS AND SERVICES (founder 2026-10-02: "have non money
-- be donated to those in need on the platform to get people tax deductions
-- who might be able to give away services (like free therapy) or goods…
-- mirrored in the marketplace flow… we then give you a receipt, kinda like
-- goodwill?").
--
-- The honest tax split (Eva to confirm; see BUSINESS.md):
--   GOODS through the 501(c)(3) are deductible at fair market value — the
--   donor values them (the Goodwill shape; our acknowledgment never states
--   a value).
--   SERVICES are NOT deductible — the IRS never allows a deduction for the
--   value of time or services. What IS potentially deductible: the donor's
--   unreimbursed out-of-pocket costs of providing them (supplies, travel,
--   space rented just for the donated sessions), and the IRS requires a
--   written acknowledgment from the charity describing the services for
--   such expenses of $250+. So the services receipt has a real legal job —
--   it just acknowledges the services instead of the (non-deductible) time.
--
-- One additive column; everything existing is goods (that's all the old
-- copy ever offered).

alter table public.inkind_donations
  add column if not exists kind text not null default 'goods'
  constraint inkind_donations_kind_check check (kind in ('goods', 'services'));
