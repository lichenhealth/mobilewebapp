-- Postgres regex caps repetition counts at 255, so {3,400} errored on every
-- url insert. Length checked separately.
alter table public.profiles drop constraint if exists profiles_clinical_home_shape;
alter table public.profiles add constraint profiles_clinical_home_shape check (
  clinical_home is null or (
    jsonb_typeof(clinical_home) = 'object'
    and length(coalesce(clinical_home->>'service','')) between 1 and 60
    and (clinical_home->>'url' is null or (clinical_home->>'url' ~ '^https://\S{3,}$' and length(clinical_home->>'url') <= 408))
    and length(coalesce(clinical_home->>'note','')) <= 200
  )
);
