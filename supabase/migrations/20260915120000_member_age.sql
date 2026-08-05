-- Age at signup (founder 2026-08-05: "marketplace for minors, but with
-- parental controls... we now need you to sign up with your age").
--
-- Everyone answers one question — 18 or older, or under 18. A minor also
-- gives their birth date, so the platform AGES THEM UP on its own rather than
-- freezing a number that goes stale the day after they answer.
--
-- birth_date is deliberately NOT in the column-scoped SELECT grant (the same
-- privacy pattern as email, phone and home location): a member's date of birth
-- is nobody else's business. Screens read `is_minor`, a derived boolean, and
-- a member reads their own birth_date through my_age().

alter table public.profiles
  add column if not exists birth_date date,
  -- true the moment they tick "18 or older", or whenever birth_date implies it.
  -- Recomputed by the trigger below, so it can never drift.
  add column if not exists is_adult boolean,
  -- when they answered, so we can tell "never asked" from "answered adult"
  add column if not exists age_declared_at timestamptz;

do $$ begin
  alter table public.profiles add constraint profiles_birth_date_sane
    check (birth_date is null or (birth_date > '1900-01-01' and birth_date <= current_date));
exception when duplicate_object then null; end $$;

-- A minor becomes an adult on their eighteenth birthday without anyone
-- touching the row: is_adult is recomputed from birth_date on every write, and
-- is_minor() computes live for reads.
create or replace function public.sync_is_adult() returns trigger
language plpgsql as $func$
begin
  if new.birth_date is not null then
    new.is_adult := (new.birth_date <= (current_date - interval '18 years'));
  end if;
  return new;
end $func$;

drop trigger if exists profiles_sync_is_adult on public.profiles;
create trigger profiles_sync_is_adult
  before insert or update on public.profiles
  for each row execute function public.sync_is_adult();

/** Live minor check — never trusts the stored flag when a birth date exists,
 *  so a member who has since turned 18 reads as an adult immediately. */
create or replace function public.is_minor(p_profile uuid)
returns boolean language sql stable security definer set search_path to 'public' as $func$
  select case
    when p.birth_date is not null then p.birth_date > (current_date - interval '18 years')
    else coalesce(p.is_adult, true) = false
  end
  from public.profiles p where p.id = p_profile;
$func$;

revoke all on function public.is_minor(uuid) from public, anon;
grant execute on function public.is_minor(uuid) to authenticated;

-- Your own age, for your own screens.
create or replace function public.my_age()
returns table (birth_date date, is_adult boolean, declared_at timestamptz)
language sql stable security definer set search_path to 'public' as $func$
  select p.birth_date, p.is_adult, p.age_declared_at
  from public.profiles p where p.id = auth.uid();
$func$;

revoke all on function public.my_age() from public, anon;
grant execute on function public.my_age() to authenticated;

-- Members write their own answer; is_adult is granted so a plain "18 or older"
-- tick can be stored without a birth date. birth_date gets NO select grant.
grant select (is_adult) on public.profiles to authenticated;
grant update (birth_date, is_adult, age_declared_at) on public.profiles to authenticated;

-- Beings (a horse, a cactus) are not people and have no age to declare.
update public.profiles set is_adult = true
 where kind <> 'person' and is_adult is null;
