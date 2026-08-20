-- APPROVE INTO THE RIGHT DOMAIN(S) (founder 2026-08-20: "providing pastries
-- might mean that you identify as a baker" — the same word can honestly be a
-- service AND an identity). The reviewer can approve a suggestion into a
-- different domain than the member typed it in, or into several at once:
-- p_domains null = the suggested domain, else exactly the listed ones.
-- If a domain already holds that name, the existing category is REUSED —
-- never a "_1" duplicate of the same word in the same world.
-- ⚠ One PostgREST candidate: the old 1-arg signature is dropped, the new one
-- has a default so the old client call shape still works.

drop function if exists public.approve_category_suggestion(uuid);

create function public.approve_category_suggestion(p_suggestion_id uuid, p_domains text[] default null) returns void
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
      -- "I am this" lands in the proposer's public identity tags.
      update public.profiles
        set identity_tags = case
          when coalesce(identity_tags, '{}') @> array[s.name] then identity_tags
          else coalesce(identity_tags, '{}') || s.name
        end
        where id = s.proposer_id;
    else
      -- "I offer this" lands in their provider categories.
      insert into public.profile_categories (profile_id, category_id)
      values (s.proposer_id, v_slug)
      on conflict do nothing;
    end if;
  end loop;

  update public.category_suggestions
    set status = 'approved', category_id = v_first_slug, decided_at = now(), decided_by = v_caller
    where id = p_suggestion_id;
end;
$func$;
