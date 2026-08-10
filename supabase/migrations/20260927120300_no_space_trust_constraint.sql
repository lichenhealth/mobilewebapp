-- ENFORCE STRUCTURALLY (founder architecture audit, 2026-08-09): trust stays
-- person-only (doctrine settled 2026-08-07, SpaceProfile.tsx's trust button
-- already removed, 20260925120000_clear_space_vouches.sql already zeroed
-- the 18 pre-existing space-trust edges). Nothing enforced the invariant at
-- the data layer though — this makes it structural, not just UI-omission.
-- Recommend (a separate table) and plain web membership (vouched=false) are
-- untouched.

alter table public.mycelium
  add constraint mycelium_no_space_trust
  check (not (vouched = true and target_type = 'space'));
