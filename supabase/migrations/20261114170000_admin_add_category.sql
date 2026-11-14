-- ADMINS ADD TO THE VOCABULARY DIRECTLY (founder 2026-11-14: "allow the admins
-- to add categories and identities from the tab, not just approve member
-- suggestions"). Same slug + reuse-same-name rules as approve_category_suggestion.
create or replace function public.admin_add_category(p_name text, p_domains text[], p_parent text default null)
returns text[]
language plpgsql security definer set search_path to 'public'
as $func$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_domain text; v_base text; v_slug text; v_n int; v_out text[] := '{}';
begin
  if not coalesce((select is_admin from public.profiles where id = auth.uid()), false) then
    raise exception 'Only Lichen admins can add to the vocabulary.';
  end if;
  if length(v_name) < 2 or length(v_name) > 60 then
    raise exception 'A name needs 2 to 60 characters.';
  end if;
  if coalesce(array_length(p_domains, 1), 0) = 0 then
    raise exception 'Pick at least one kind: goods, services, places or identities.';
  end if;
  if p_parent is not null and not exists (select 1 from public.categories where id = p_parent and parent_id is null) then
    raise exception 'That parent category doesn''t exist.';
  end if;
  foreach v_domain in array p_domains loop
    if v_domain not in ('good', 'service', 'place', 'identity') then
      raise exception 'Unknown kind: %', v_domain;
    end if;
    select id into v_slug from public.categories where domain = v_domain and lower(name) = lower(v_name) limit 1;
    if v_slug is null then
      v_base := trim(both '_' from left(v_domain, 1) || '_' || regexp_replace(lower(v_name), '[^a-z0-9]+', '_', 'g'));
      if v_base = left(v_domain, 1) or v_base = left(v_domain, 1) || '_' then v_base := left(v_domain, 1) || '_custom'; end if;
      v_slug := v_base; v_n := 0;
      while exists (select 1 from public.categories where id = v_slug) loop
        v_n := v_n + 1; v_slug := v_base || '_' || v_n;
      end loop;
      insert into public.categories (id, domain, name, sort, parent_id)
      values (v_slug, v_domain, v_name, 1000,
        case when p_parent is not null and (select domain from public.categories where id = p_parent) = v_domain then p_parent end);
    end if;
    v_out := v_out || v_slug;
  end loop;
  return v_out;
end;
$func$;
revoke all on function public.admin_add_category(text, text[], text) from public, anon;
grant execute on function public.admin_add_category(text, text[], text) to authenticated;
