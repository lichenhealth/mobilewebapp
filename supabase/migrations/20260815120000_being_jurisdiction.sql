-- JURISDICTION FOR DISTRIBUTED BEINGS (founder 2026-08-14): "Plants and
-- Elements do need geo-boxing in ways that Animals don't. Each animal is
-- already somewhere." A plant or an element exists in many places at once,
-- so its stewardship must name a SPECIFIC scope now — "the Skagit
-- watershed", not "water" — with field-level/overall stewards a possible
-- later chapter (the aspect column's individual-vs-collective axis already
-- holds that door open). Animals/places/collectives may carry one; plants
-- and elements must.

alter table public.profiles add column jurisdiction text;

comment on column public.profiles.jurisdiction is
  'The named scope a stewarded being is tended within ("the Skagit watershed"). REQUIRED for plant/element kinds (distributed beings), optional otherwise. Public — it is part of the being''s identity.';

-- Public like identity_tags: the jurisdiction is who the being IS.
grant select (jurisdiction) on public.profiles to anon;
grant select (jurisdiction) on public.profiles to authenticated;

alter table public.profiles
  add constraint profiles_distributed_jurisdiction
  check (kind not in ('plant', 'element') or jurisdiction is not null);

-- One PostgREST candidate only (the request_exchange lesson): drop the old
-- 4-arg signature before creating the 5-arg one.
drop function if exists public.create_entity_profile(text, text, text, uuid);

create function public.create_entity_profile(
  p_name text, p_kind text, p_aspect text default 'individual',
  p_steward_space uuid default null, p_jurisdiction text default null
) returns uuid
language plpgsql security definer set search_path = 'public' as $func$
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
  if p_kind in ('plant','element') and btrim(coalesce(p_jurisdiction, '')) = '' then
    raise exception 'Plants and elements are in many places at once — name the jurisdiction this one is tended within.';
  end if;
  -- Stewarding through a space is the succession story: you must admin it.
  if p_steward_space is not null and not public.is_space_admin(p_steward_space, v_uid) then
    raise exception 'you do not steward that space';
  end if;

  insert into public.profiles (id, full_name, kind, aspect, onboarded, jurisdiction,
                               steward_profile_id, steward_space_id)
  values (v_id, btrim(p_name), p_kind, coalesce(p_aspect, 'individual'), true,
          nullif(btrim(coalesce(p_jurisdiction, '')), ''),
          case when p_steward_space is null then v_uid else null end,
          p_steward_space);
  return v_id;
end $func$;

revoke all on function public.create_entity_profile(text, text, text, uuid, text) from public, anon;
grant execute on function public.create_entity_profile(text, text, text, uuid, text) to authenticated;
