-- CASE BY CASE, FIELD BY FIELD (founder 2026-08-20): "maybe you don't want
-- your credit score in there, but you do want your monthly expenses, in case
-- Claude can help you streamline your budgeting."
--
-- The blanket boolean added an hour ago was too coarse for that, and it
-- defaulted the wrong way: the founder's point is that this intelligence can
-- be INVALUABLE — the right intervention for a diagnosis, the right way
-- through a financial hole — so the help is available and each line is the
-- member's to withhold. Nothing shipped on the boolean; it goes.
alter table public.financial_positions drop column if exists ai_omit;
alter table public.financial_positions
  add column if not exists ai_omit_fields text[] not null default '{}';
alter table public.financial_positions drop constraint if exists financial_positions_ai_omit_fields_check;
alter table public.financial_positions add constraint financial_positions_ai_omit_fields_check
  check (ai_omit_fields <@ array[
    'assets','debt','monthly_income','monthly_expenses',
    'income_band','household_size','circumstances','obstacles','needs'
  ]::text[]);
