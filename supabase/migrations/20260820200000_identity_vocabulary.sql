-- IDENTITIES JOIN THE GOVERNED VOCABULARY (founder 2026-08-20: "if an
-- identity exists, it adds it. If it doesn't, it prompts you to 'suggest
-- identity to Lichen'"). A fourth categories domain rides the whole
-- existing suggest -> pending -> admin-approve loop instead of a parallel
-- system. profiles.identity_tags stays the storage (public names, what
-- gift-to-identity offers match against); the vocabulary constrains and
-- canonicalizes what goes in. Spaces get the same column — a community can
-- be local OR identity-based (the community of founders).

-- 1 · The domain CHECKs grow a value (text + CHECK, not an enum — the
--     documented pattern: change the CHECK).
alter table public.categories drop constraint categories_domain_check;
alter table public.categories add constraint categories_domain_check
  check (domain = any (array['good'::text, 'service'::text, 'place'::text, 'identity'::text]));

alter table public.category_suggestions drop constraint category_suggestions_domain_check;
alter table public.category_suggestions add constraint category_suggestions_domain_check
  check (domain = any (array['good'::text, 'service'::text, 'place'::text, 'identity'::text]));

-- 2 · A modest starter vocabulary — vocational/community identities only
--     (nothing sensitive seeded; members grow it via suggestions).
insert into public.categories (id, domain, name, sort) values
  ('i_first_responder',     'identity', 'First Responder',      0),
  ('i_firefighter',         'identity', 'Firefighter',          0),
  ('i_emt_paramedic',       'identity', 'EMT / Paramedic',      0),
  ('i_veteran',             'identity', 'Veteran',              0),
  ('i_active_duty',         'identity', 'Active-Duty Military', 0),
  ('i_military_family',     'identity', 'Military Family',      0),
  ('i_nurse',               'identity', 'Nurse',                0),
  ('i_healthcare_worker',   'identity', 'Healthcare Worker',    0),
  ('i_teacher',             'identity', 'Teacher',              0),
  ('i_farmer',              'identity', 'Farmer',               0),
  ('i_artist',              'identity', 'Artist',               0),
  ('i_musician',            'identity', 'Musician',             0),
  ('i_maker',               'identity', 'Maker / Craftsperson', 0),
  ('i_founder',             'identity', 'Founder',              0),
  ('i_small_business_owner','identity', 'Small-Business Owner', 0),
  ('i_single_parent',       'identity', 'Single Parent',        0),
  ('i_caregiver',           'identity', 'Caregiver',            0),
  ('i_elder',               'identity', 'Elder',                0),
  ('i_student',             'identity', 'Student',              0),
  ('i_immigrant',           'identity', 'Immigrant',            0)
on conflict (id) do nothing;

-- 3 · A community (any space) can carry identities too.
alter table public.spaces add column if not exists identity_tags text[];

-- 4 · Approving an IDENTITY suggestion lands in the proposer's own
--     identity_tags — profile_categories means "I offer this", which is the
--     wrong shape for "I am this". Goods/services/places keep the old path.
create or replace function public.approve_category_suggestion(p_suggestion_id uuid) returns void
    language plpgsql security definer
    set search_path to 'public'
    as $func$
declare
  s public.category_suggestions;
  v_caller   uuid := auth.uid();
  v_is_admin boolean;
  v_base text;
  v_slug text;
  v_n int := 0;
begin
  select is_admin into v_is_admin from public.profiles where id = v_caller;
  if not coalesce(v_is_admin, false) then
    raise exception 'Not authorized';
  end if;

  select * into s from public.category_suggestions where id = p_suggestion_id;
  if s.id is null then raise exception 'Suggestion not found'; end if;
  if s.status <> 'pending' then raise exception 'Already decided'; end if;

  v_base := left(s.domain, 1) || '_' || regexp_replace(lower(s.name), '[^a-z0-9]+', '_', 'g');
  v_base := trim(both '_' from v_base);
  if v_base = '' or v_base = left(s.domain,1) || '_' then v_base := left(s.domain,1) || '_custom'; end if;
  v_slug := v_base;
  while exists (select 1 from public.categories where id = v_slug) loop
    v_n := v_n + 1;
    v_slug := v_base || '_' || v_n;
  end loop;

  insert into public.categories (id, domain, name, sort)
  values (v_slug, s.domain, s.name, 1000);

  if s.domain = 'identity' then
    update public.profiles
      set identity_tags = case
        when coalesce(identity_tags, '{}') @> array[s.name] then identity_tags
        else coalesce(identity_tags, '{}') || s.name
      end
      where id = s.proposer_id;
  else
    insert into public.profile_categories (profile_id, category_id)
    values (s.proposer_id, v_slug)
    on conflict do nothing;
  end if;

  update public.category_suggestions
    set status = 'approved', category_id = v_slug, decided_at = now(), decided_by = v_caller
    where id = p_suggestion_id;
end;
$func$;
