-- THE FINANCIAL HEALTH PROFILE GROWS UP (founder 2026-08-20): what a subsidy
-- decision actually needs, in the shape people already know from a loan
-- application — assets, debt, monthly income, monthly expenses — plus the
-- part loan applications never ask: WHAT DO YOU ACTUALLY NEED, and what's in
-- the way of getting it.
--
-- The founder's insight, and the reason a coordinator is a person and not a
-- form: "the current system is unforgiving of what the person really needs
-- (time off from their job, for example). Even if Lichen gave them pay for
-- their time off, maybe their company won't approve their leave." A number
-- can't solve that; someone working it through with them can.
--
-- Amounts are numeric and NULLABLE throughout — a profile half-answered is
-- still a profile, and "prefer not to say" stays a first-class answer.
alter table public.financial_positions
  add column if not exists assets numeric,
  add column if not exists debt numeric,
  add column if not exists monthly_income numeric,
  add column if not exists monthly_expenses numeric,
  -- What they're asking the network for: care | goods | services | time_off
  add column if not exists needs text[] not null default '{}',
  -- What's in the way (the social-worker piece): employer leave policy, a
  -- lease, a licence, whatever the money alone doesn't fix.
  add column if not exists obstacles text;

alter table public.financial_positions drop constraint if exists financial_positions_needs_check;
alter table public.financial_positions add constraint financial_positions_needs_check
  check (needs <@ array['care','goods','services','time_off']::text[]);
