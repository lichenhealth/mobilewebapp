-- IDENTITY + MEANS (founder 2026-07-27): two halves of the exchange algorithm's
-- honesty bargain. (1) PUBLIC identity tags on profiles ("Firefighter",
-- "Veteran") — what gift-targeted offers will one day match against.
-- (2) PRIVATE financial position — the Economic aspect of the Web of
-- Wellbeing: owner-written, readable ONLY by the owner and their ACTIVE care
-- team (the phone-number pattern), never displayed as a score anywhere.
-- Site alignment: subsidy recipients provide honest details that inform the
-- exchange algorithm.

-- ── 1. Identity tags (public-facing) ─────────────────────────────────────────
alter table public.profiles add column if not exists identity_tags text[];
grant select (identity_tags) on public.profiles to anon, authenticated;
-- (owner UPDATE rides the existing table-level grant + own-row policy)

-- ── 2. Financial position (private, care-team-scoped) ────────────────────────
create table if not exists public.financial_positions (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  income_band text check (income_band in
    ('under_25k', '25k_50k', '50k_100k', '100k_200k', 'over_200k')),
  household_size int check (household_size between 1 and 20),
  circumstances text,                    -- their own words, the honest picture
  updated_at timestamptz not null default now()
);
alter table public.financial_positions enable row level security;

-- Owner writes their own truth.
create policy "means: own all" on public.financial_positions
  for all to authenticated
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

-- The active care team may read (never write) — informed care, no scores.
create policy "means: care team reads" on public.financial_positions
  for select to authenticated using (
    exists (
      select 1 from public.care_team_members c
      where c.patient_id = financial_positions.profile_id
        and c.caregiver_id = auth.uid()
        and c.status = 'active'
    )
  );
