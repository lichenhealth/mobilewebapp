-- STEWARDSHIP — beyond-human members (founder 2026-08-05: "a way to add a
-- profile as a steward, so I can steward Tango and the Huachuma Foundation
-- can steward the San Pedro cactus").
--
-- This is the entity generalization the schema already anticipated —
-- 20260630120000_posts_mycelium.sql:6 says: "When profiles generalizes to
-- multi-species entities (kind + steward), these rows simply become entities;
-- no change needed here."
--
-- profiles.id is the platform's universal actor key (~114 FK columns across
-- ~76 tables). The moment an entity is a profile row it can hold Current-cy,
-- be woven and trusted, own a calendar, be booked and be recommended — with
-- no new plumbing. ledgerApi is ALREADY polymorphic ('profile' | 'space').
--
-- THE STRUCTURAL CHANGE: profiles.id no longer references auth.users. A horse
-- has no password. Every existing `auth.uid() = id` policy keeps working
-- unchanged — it simply never matches an entity, which is exactly right:
-- nobody logs in as the horse. The ON DELETE CASCADE the FK provided is
-- preserved below by an explicit trigger, so deleting a person still removes
-- their profile.

-- ── 1. Let a profile exist without a login ────────────────────────────────
alter table public.profiles drop constraint if exists profiles_id_fkey;

-- …and keep the cascade the FK used to give us.
create or replace function public.handle_auth_user_deleted() returns trigger
language plpgsql security definer set search_path to 'public' as $func$
begin
  delete from public.profiles where id = old.id;
  return old;
end $func$;

drop trigger if exists on_auth_user_deleted on auth.users;
create trigger on_auth_user_deleted
  after delete on auth.users
  for each row execute function public.handle_auth_user_deleted();

-- ── 2. What kind of being, and who tends it ───────────────────────────────
-- aspect is INDIVIDUAL vs COLLECTIVE (Tango is an individual; Huachuma is a
-- collective spirit) — the axis settled 2026-07-18. It is deliberately NOT
-- plant-vs-animal: both kinds can be either.
alter table public.profiles
  add column if not exists kind text not null default 'person',
  add column if not exists aspect text,
  add column if not exists steward_profile_id uuid references public.profiles(id) on delete set null,
  add column if not exists steward_space_id uuid references public.spaces(id) on delete set null;

do $$ begin
  alter table public.profiles add constraint profiles_kind_check
    check (kind in ('person', 'plant', 'animal', 'place', 'element', 'collective'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.profiles add constraint profiles_aspect_check
    check (aspect is null or aspect in ('individual', 'collective'));
exception when duplicate_object then null; end $$;

-- A person has no steward. A being has exactly one — a person OR a space.
-- Space-stewardship reuses admin roles, which is what solves succession.
do $$ begin
  alter table public.profiles add constraint profiles_steward_check check (
    case when kind = 'person'
      then steward_profile_id is null and steward_space_id is null
      else (steward_profile_id is not null) <> (steward_space_id is not null)
    end
  );
exception when duplicate_object then null; end $$;

create index if not exists profiles_steward_profile_idx
  on public.profiles (steward_profile_id) where steward_profile_id is not null;
create index if not exists profiles_steward_space_idx
  on public.profiles (steward_space_id) where steward_space_id is not null;

-- ⚠ profiles' SELECT is COLUMN-SCOPED (the email-privacy pattern from
-- 20260629120100). New columns are invisible to clients without this grant.
grant select (kind, aspect, steward_profile_id, steward_space_id)
  on public.profiles to authenticated, anon;

-- ── 3. Who may act for a being ────────────────────────────────────────────
-- Modelled on is_active_caregiver / is_space_admin: STABLE SECURITY DEFINER,
-- revoked from public+anon, granted to authenticated.
create or replace function public.is_entity_steward(p_entity uuid, p_uid uuid)
returns boolean language sql stable security definer set search_path to 'public' as $func$
  select exists (
    select 1 from public.profiles p
    where p.id = p_entity
      and p.kind <> 'person'
      and (
        p.steward_profile_id = p_uid
        or (p.steward_space_id is not null and public.is_space_admin(p.steward_space_id, p_uid))
      )
  );
$func$;

revoke all on function public.is_entity_steward(uuid, uuid) from public, anon;
grant execute on function public.is_entity_steward(uuid, uuid) to authenticated;

-- A steward edits the being's profile as if it were their own.
drop policy if exists "Users update own profile" on public.profiles;
create policy "Users update own profile" on public.profiles
  for update to authenticated
  using (auth.uid() = id or public.is_entity_steward(id, auth.uid()))
  with check (auth.uid() = id or public.is_entity_steward(id, auth.uid()));

-- ── 4. The only door for making one ───────────────────────────────────────
-- profiles has no INSERT policy by design (creation has always been
-- server-side), so entities arrive through a SECURITY DEFINER RPC — the same
-- shape as set_member_role, claim_invite, gift_subscription.
create or replace function public.create_entity_profile(
  p_name text,
  p_kind text,
  p_aspect text default 'individual',
  p_steward_space uuid default null
) returns uuid language plpgsql security definer set search_path to 'public' as $func$
declare
  v_uid uuid := auth.uid();
  v_id uuid := gen_random_uuid();
begin
  if v_uid is null then
    raise exception 'sign in first';
  end if;
  if p_kind = 'person' or p_kind not in ('plant','animal','place','element','collective') then
    raise exception 'a stewarded being is not a person';
  end if;
  if btrim(coalesce(p_name, '')) = '' then
    raise exception 'a being needs a name';
  end if;
  -- Stewarding through a space is the succession story: you must admin it.
  if p_steward_space is not null and not public.is_space_admin(p_steward_space, v_uid) then
    raise exception 'you do not steward that space';
  end if;

  insert into public.profiles (id, full_name, kind, aspect, onboarded,
                               steward_profile_id, steward_space_id)
  values (v_id, btrim(p_name), p_kind, coalesce(p_aspect, 'individual'), true,
          case when p_steward_space is null then v_uid else null end,
          p_steward_space);
  return v_id;
end $func$;

revoke all on function public.create_entity_profile(text, text, text, uuid) from public, anon;
grant execute on function public.create_entity_profile(text, text, text, uuid) to authenticated;

-- ── 5. A steward may post as their being ──────────────────────────────────
-- Same shape as acting-as-a-space: author_space_id was already delegated via
-- is_space_admin; author_id now delegates via is_entity_steward.
drop policy if exists "posts: insert own" on public.posts;
create policy "posts: insert own" on public.posts
  for insert to authenticated
  with check (
    (author_id = auth.uid() or public.is_entity_steward(author_id, auth.uid()))
    and (is_public or to_mycelium or cardinality(audience_space_ids) > 0)
    and not exists (
      select 1 from unnest(posts.audience_space_ids) a(sid)
      where not exists (
        select 1 from public.space_members m
        where m.space_id = a.sid and m.profile_id = auth.uid()
      )
    )
    and (author_space_id is null or public.is_space_admin(author_space_id, auth.uid()))
  );
