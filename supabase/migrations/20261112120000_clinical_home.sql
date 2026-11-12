-- Clinical home (founder 2026-11-12): a licensed provider names the HIPAA
-- platform where their clinical communication lives (SimplePractice, Spruce,
-- Hushmail…). Lichen points there; it never copies clinical records in —
-- copying them would make Lichen a business associate. Members-only read.
alter table public.profiles add column if not exists clinical_home jsonb;
alter table public.profiles drop constraint if exists profiles_clinical_home_shape;
alter table public.profiles add constraint profiles_clinical_home_shape check (
  clinical_home is null or (
    jsonb_typeof(clinical_home) = 'object'
    and length(coalesce(clinical_home->>'service','')) between 1 and 60
    and (clinical_home->>'url' is null or clinical_home->>'url' ~ '^https://[^\s]{3,400}$')
    and length(coalesce(clinical_home->>'note','')) <= 200
  )
);
grant select (clinical_home) on public.profiles to authenticated;
