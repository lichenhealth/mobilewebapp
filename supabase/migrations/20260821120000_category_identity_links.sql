-- THE OVERLAP, HONORED BUT NEVER INFERRED (founder 2026-08-20: "providing
-- pastries might mean that you identify as a baker" — and, same breath,
-- "some beekeepers just want to do their job and not see it as an
-- identity"). A curated many-to-many link from provider categories to
-- kindred identities powers a one-time OFFER at the moment of overlap —
-- "do you also see yourself as a Farmer?" — never an auto-add. Declining is
-- silent and final (member_prompts, topic identity-offer-<identityId>).

create table public.category_identity_links (
  category_id text not null references public.categories(id) on delete cascade,
  identity_id text not null references public.categories(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (category_id, identity_id)
);

-- A link points FROM a provider category TO an identity — enforce the
-- domains (a CHECK can't subquery; the pattern is a small trigger).
create function public.check_category_identity_link() returns trigger
language plpgsql as $func$
begin
  if (select domain from public.categories where id = new.category_id) = 'identity' then
    raise exception 'category_id must be a provider category, not an identity';
  end if;
  if (select domain from public.categories where id = new.identity_id) <> 'identity' then
    raise exception 'identity_id must be an identity category';
  end if;
  return new;
end;
$func$;

create trigger enforce_category_identity_link
  before insert or update on public.category_identity_links
  for each row execute function public.check_category_identity_link();

alter table public.category_identity_links enable row level security;
create policy "links readable" on public.category_identity_links
  for select to authenticated using (true);
create policy "links: admins write" on public.category_identity_links
  for all to authenticated
  using (coalesce((select is_admin from public.profiles where id = auth.uid()), false))
  with check (coalesce((select is_admin from public.profiles where id = auth.uid()), false));

-- Seed the defensible pairs in today's vocabulary — small on purpose; an
-- imperfect link produces a bad question, so only clear kinships ship.
insert into public.category_identity_links (category_id, identity_id) values
  ('s_agriculture_farming',          'i_farmer'),
  ('s_education_tutoring',           'i_teacher'),
  ('g_art_handcrafts',               'i_artist'),
  ('g_art_handcrafts',               'i_maker'),
  ('s_photo_video',                  'i_artist'),
  ('s_childcare',                    'i_caregiver'),
  ('s_hospice_end_of_life_support',  'i_caregiver')
on conflict do nothing;

-- Approving one suggestion into an identity AND a provider domain is itself
-- the statement that they're kindred — the RPC links them as it lands them.
create or replace function public.approve_category_suggestion(p_suggestion_id uuid, p_domains text[] default null) returns void
    language plpgsql security definer
    set search_path to 'public'
    as $func$
declare
  s public.category_suggestions;
  v_caller   uuid := auth.uid();
  v_is_admin boolean;
  v_domains text[];
  v_domain text;
  v_base text;
  v_slug text;
  v_n int;
  v_first_slug text;
  v_identity_slug text;
  v_provider_slugs text[] := '{}';
begin
  select is_admin into v_is_admin from public.profiles where id = v_caller;
  if not coalesce(v_is_admin, false) then
    raise exception 'Not authorized';
  end if;

  select * into s from public.category_suggestions where id = p_suggestion_id;
  if s.id is null then raise exception 'Suggestion not found'; end if;
  if s.status <> 'pending' then raise exception 'Already decided'; end if;

  v_domains := coalesce(p_domains, array[s.domain]);
  if coalesce(array_length(v_domains, 1), 0) = 0 then v_domains := array[s.domain]; end if;

  foreach v_domain in array v_domains loop
    if v_domain not in ('good', 'service', 'place', 'identity') then
      raise exception 'Unknown domain: %', v_domain;
    end if;

    -- Reuse a same-name category already in this domain, else mint one.
    select id into v_slug from public.categories
      where domain = v_domain and lower(name) = lower(s.name) limit 1;
    if v_slug is null then
      v_base := left(v_domain, 1) || '_' || regexp_replace(lower(s.name), '[^a-z0-9]+', '_', 'g');
      v_base := trim(both '_' from v_base);
      if v_base = '' or v_base = left(v_domain, 1) || '_' then v_base := left(v_domain, 1) || '_custom'; end if;
      v_slug := v_base; v_n := 0;
      while exists (select 1 from public.categories where id = v_slug) loop
        v_n := v_n + 1;
        v_slug := v_base || '_' || v_n;
      end loop;
      insert into public.categories (id, domain, name, sort)
      values (v_slug, v_domain, s.name, 1000);
    end if;
    if v_first_slug is null then v_first_slug := v_slug; end if;

    if v_domain = 'identity' then
      v_identity_slug := v_slug;
      -- "I am this" lands in the proposer's public identity tags.
      update public.profiles
        set identity_tags = case
          when coalesce(identity_tags, '{}') @> array[s.name] then identity_tags
          else coalesce(identity_tags, '{}') || s.name
        end
        where id = s.proposer_id;
    else
      v_provider_slugs := v_provider_slugs || v_slug;
      -- "I offer this" lands in their provider categories.
      insert into public.profile_categories (profile_id, category_id)
      values (s.proposer_id, v_slug)
      on conflict do nothing;
    end if;
  end loop;

  -- Landed in both worlds at once → the worlds are kindred; remember it.
  if v_identity_slug is not null and coalesce(array_length(v_provider_slugs, 1), 0) > 0 then
    insert into public.category_identity_links (category_id, identity_id)
    select unnest(v_provider_slugs), v_identity_slug
    on conflict do nothing;
  end if;

  update public.category_suggestions
    set status = 'approved', category_id = v_first_slug, decided_at = now(), decided_by = v_caller
    where id = p_suggestion_id;
end;
$func$;
