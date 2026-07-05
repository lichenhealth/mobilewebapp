-- =============================================================================
-- Concierge on-call + profile basics (first/last name, phone)
--
-- 1. profiles gains first_name / last_name / phone.
--    * first_name + last_name ARE granted to authenticated (names are public
--      in-app, same as full_name).
--    * phone is deliberately NOT granted — the profiles SELECT grant is
--      column-scoped (see 20260629120100, email precedent) and the row policy
--      is USING(true), so a column grant would expose it to every member.
--      Phone is reachable only via my_phone() (owner) and on_call_roster()
--      (a patient's active care team).
-- 2. full_name stays the display name everywhere; a trigger composes it from
--    first/last whenever those are present. Signup (handle_new_user) inserts
--    with first/last NULL, so the trigger leaves signup names untouched.
-- 3. Backfill splits existing full_name on the first space.
-- 4. on_call_roster(patient): the patient's ACTIVE caregivers + their
--    kind='on_call' availability windows + phone. SECURITY DEFINER on purpose:
--    care-team semantics, independent of calendar share rules and of the
--    owner-only RLS on availability_windows. The WHERE gate (caller is the
--    patient or one of their active caregivers) is the ONLY access control.
-- =============================================================================

-- 1 ─ columns ----------------------------------------------------------------
alter table public.profiles add column if not exists first_name text;
alter table public.profiles add column if not exists last_name  text;
alter table public.profiles add column if not exists phone      text;

grant select (first_name, last_name) on public.profiles to authenticated;
-- (no grant for phone — see header)

-- 2 ─ compose full_name from first/last ---------------------------------------
create or replace function public.compose_full_name() returns trigger
language plpgsql as $$
begin
  -- Conditional on purpose: signup inserts rows with first/last null and
  -- full_name from auth metadata — those must pass through unchanged.
  if new.first_name is not null or new.last_name is not null then
    new.full_name := btrim(concat_ws(' ', new.first_name, new.last_name));
  end if;
  return new;
end $$;

drop trigger if exists profiles_compose_full_name on public.profiles;
create trigger profiles_compose_full_name
  before insert or update on public.profiles
  for each row execute function public.compose_full_name();

-- 3 ─ backfill existing members (imperfect splits are fine — Profile edit fixes)
update public.profiles set
  first_name = nullif(split_part(full_name, ' ', 1), ''),
  last_name  = nullif(btrim(substring(full_name from position(' ' in full_name) + 1)), '')
where first_name is null
  and coalesce(full_name, '') <> ''
  and position(' ' in full_name) > 0;

update public.profiles set
  first_name = nullif(btrim(full_name), '')
where first_name is null and coalesce(full_name, '') <> '';

-- 4 ─ on-call roster ----------------------------------------------------------
create or replace function public.on_call_roster(p_patient uuid)
returns table (
  caregiver_id uuid,
  full_name    text,
  headline     text,
  avatar_url   text,
  phone        text,
  window_id    uuid,
  weekday      smallint,
  start_min    smallint,
  end_min      smallint,
  valid_from   date,
  valid_to     date
)
language sql stable security definer set search_path to 'public' as $$
  select ct.caregiver_id, p.full_name, p.headline, p.avatar_url, p.phone,
         w.id, w.weekday, w.start_min, w.end_min, w.valid_from, w.valid_to
  from public.care_team_members ct
  join public.profiles p on p.id = ct.caregiver_id
  left join public.availability_windows w
    on w.profile_id = ct.caregiver_id and w.kind = 'on_call'
  where ct.patient_id = p_patient
    and ct.status = 'active'
    and (
      auth.uid() = p_patient
      or exists (
        select 1 from public.care_team_members me
        where me.patient_id = p_patient
          and me.caregiver_id = auth.uid()
          and me.status = 'active'
      )
    );
$$;

alter function public.on_call_roster(uuid) owner to postgres;
revoke all on function public.on_call_roster(uuid) from public, anon;
grant execute on function public.on_call_roster(uuid) to authenticated;

-- 5 ─ own phone (the column has no SELECT grant, so even the owner reads via RPC)
create or replace function public.my_phone() returns text
language sql stable security definer set search_path to 'public' as
$$ select phone from public.profiles where id = auth.uid() $$;

alter function public.my_phone() owner to postgres;
revoke all on function public.my_phone() from public, anon;
grant execute on function public.my_phone() to authenticated;
