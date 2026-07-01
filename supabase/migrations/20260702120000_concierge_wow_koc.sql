-- =============================================================================
-- Concierge: real per-patient WOW (health_snapshots) + KOC (care_plans / items).
--
-- NOT auto-applied. Run in the Supabase SQL editor, then refresh the init.sql
-- baseline with pg_dump. Idempotent where practical.
--
-- Practitioner-authored now; the same rows are AI-writable later. Read access =
-- anyone on the patient's care team (the patient + active caregivers); write
-- access = an active caregiver of that patient. Policies ship WITH the tables —
-- the `rls_auto_enable` event trigger locks new public tables otherwise.
-- =============================================================================

-- ── Helpers ──────────────────────────────────────────────────────────────────
-- Split read vs author so patient self-authoring can be enabled later by
-- widening one policy (is_on_care_team) without touching reads.

create or replace function public.is_on_care_team(p_patient uuid, p_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_uid = p_patient
      or exists (select 1 from public.care_team_members c
                 where c.patient_id = p_patient and c.caregiver_id = p_uid
                   and c.status = 'active');
$$;
alter function public.is_on_care_team(uuid, uuid) owner to postgres;

create or replace function public.is_active_caregiver(p_patient uuid, p_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.care_team_members c
                 where c.patient_id = p_patient and c.caregiver_id = p_uid
                   and c.status = 'active');
$$;
alter function public.is_active_caregiver(uuid, uuid) owner to postgres;

-- ── WOW: health_snapshots ────────────────────────────────────────────────────
-- Fixed canonical 6 axes → 6 real columns (CHECK-constrained). `sections` is
-- genuinely variable, so it stays jsonb. Display = latest by snapshot_date.
create table if not exists public.health_snapshots (
  id              uuid primary key default gen_random_uuid(),
  patient_id      uuid not null references public.profiles(id) on delete cascade,
  author_id       uuid not null references public.profiles(id),
  snapshot_date   date not null,
  summary         text not null default '',
  score_mental    smallint not null check (score_mental    between 0 and 100),
  score_physical  smallint not null check (score_physical  between 0 and 100),
  score_emotional smallint not null check (score_emotional between 0 and 100),
  score_social    smallint not null check (score_social    between 0 and 100),
  score_financial smallint not null check (score_financial between 0 and 100),
  score_spirit    smallint not null check (score_spirit    between 0 and 100),
  -- [{ title text, items text[], body text }] — body may contain {{ai:…}} markup
  sections        jsonb not null default '[]'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (patient_id, snapshot_date)
);
alter table public.health_snapshots enable row level security;
create index if not exists health_snapshots_patient_date_idx
  on public.health_snapshots (patient_id, snapshot_date desc, created_at desc);

drop trigger if exists health_snapshots_touch on public.health_snapshots;
create trigger health_snapshots_touch before update on public.health_snapshots
  for each row execute function public.touch_updated_at();

drop policy if exists "wow read"   on public.health_snapshots;
drop policy if exists "wow insert" on public.health_snapshots;
drop policy if exists "wow update" on public.health_snapshots;
drop policy if exists "wow delete" on public.health_snapshots;

create policy "wow read" on public.health_snapshots for select to authenticated
  using (public.is_on_care_team(patient_id, auth.uid()));
create policy "wow insert" on public.health_snapshots for insert to authenticated
  with check (author_id = auth.uid() and public.is_active_caregiver(patient_id, auth.uid()));
create policy "wow update" on public.health_snapshots for update to authenticated
  using (public.is_active_caregiver(patient_id, auth.uid()))
  with check (author_id = auth.uid() and public.is_active_caregiver(patient_id, auth.uid()));
create policy "wow delete" on public.health_snapshots for delete to authenticated
  using (public.is_active_caregiver(patient_id, auth.uid()));

-- ── KOC: care_plans + care_plan_items ────────────────────────────────────────
create table if not exists public.care_plans (
  id         uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.profiles(id) on delete cascade,
  author_id  uuid not null references public.profiles(id),
  week_start date not null,                       -- Monday of the plan week
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (patient_id, week_start)
);
alter table public.care_plans enable row level security;
create index if not exists care_plans_patient_week_idx
  on public.care_plans (patient_id, week_start desc);

drop trigger if exists care_plans_touch on public.care_plans;
create trigger care_plans_touch before update on public.care_plans
  for each row execute function public.touch_updated_at();

create table if not exists public.care_plan_items (
  id             uuid primary key default gen_random_uuid(),
  plan_id        uuid not null references public.care_plans(id) on delete cascade,
  is_daily       boolean not null default false,  -- true → recurring "Daily" block
  item_date      date,                            -- null iff is_daily
  provider_id    uuid references public.profiles(id) on delete set null,
  provider_label text,                            -- fallback for off-platform providers
  body           text not null,                   -- may contain [phrase] / {icon} markup
  sort           integer not null default 0,
  created_at     timestamptz not null default now(),
  constraint care_plan_items_day_chk check (
    (is_daily and item_date is null) or (not is_daily and item_date is not null)),
  constraint care_plan_items_provider_chk check (
    provider_id is not null or (provider_label is not null and length(btrim(provider_label)) > 0))
);
alter table public.care_plan_items enable row level security;
create index if not exists care_plan_items_plan_idx
  on public.care_plan_items (plan_id, is_daily desc, item_date, sort);

drop policy if exists "koc plan read"   on public.care_plans;
drop policy if exists "koc plan insert" on public.care_plans;
drop policy if exists "koc plan update" on public.care_plans;
drop policy if exists "koc plan delete" on public.care_plans;
create policy "koc plan read" on public.care_plans for select to authenticated
  using (public.is_on_care_team(patient_id, auth.uid()));
create policy "koc plan insert" on public.care_plans for insert to authenticated
  with check (author_id = auth.uid() and public.is_active_caregiver(patient_id, auth.uid()));
create policy "koc plan update" on public.care_plans for update to authenticated
  using (public.is_active_caregiver(patient_id, auth.uid()))
  with check (author_id = auth.uid() and public.is_active_caregiver(patient_id, auth.uid()));
create policy "koc plan delete" on public.care_plans for delete to authenticated
  using (public.is_active_caregiver(patient_id, auth.uid()));

-- Items inherit their plan's patient for the RLS check. Single FOR ALL write
-- policy since insert/update/delete share the same predicate.
drop policy if exists "koc item read"  on public.care_plan_items;
drop policy if exists "koc item write" on public.care_plan_items;
create policy "koc item read" on public.care_plan_items for select to authenticated
  using (exists (select 1 from public.care_plans p
                 where p.id = plan_id and public.is_on_care_team(p.patient_id, auth.uid())));
create policy "koc item write" on public.care_plan_items for all to authenticated
  using (exists (select 1 from public.care_plans p
                 where p.id = plan_id and public.is_active_caregiver(p.patient_id, auth.uid())))
  with check (exists (select 1 from public.care_plans p
                 where p.id = plan_id and public.is_active_caregiver(p.patient_id, auth.uid())));
