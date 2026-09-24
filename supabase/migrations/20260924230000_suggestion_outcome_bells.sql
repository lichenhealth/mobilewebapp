-- THE SUGGESTER HEARS EVERY OUTCOME (founder 2026-09-24: "make sure the
-- person who suggested it is notified whether it is accepted, rejected,
-- rolled into another category or edited. If it's accepted as-is, it is
-- just added to their identities. If edited or rolled into another
-- category, they choose whether they want to add it to their identities.")
--
-- Three doors, one grammar:
--   approve AS-IS    → auto-add (identity_tags / profile_categories) + bell
--   approve EDITED   → nothing auto-added; the bell links the door where
--                      adding it is the proposer's own one-tap choice
--   alias ("Same as…") → same choose-for-yourself bell, naming the category
--   reject           → a plain, kind bell
-- notify() itself skips a self-decision (recipient = actor).

-- 1) approve gains p_name — the reviewer can EDIT the name on approval
--    ("Therapist" saved as "Psychotherapist"). ⚠ One PostgREST candidate:
--    the 2-arg signature is dropped; the new arg defaults, so old call
--    shapes still work.
drop function if exists public.approve_category_suggestion(uuid, text[]);

create function public.approve_category_suggestion(
  p_suggestion_id uuid, p_domains text[] default null, p_name text default null
) returns void
language plpgsql security definer set search_path to 'public' as $func$
declare
  s public.category_suggestions;
  v_caller uuid := auth.uid();
  v_is_admin boolean;
  v_domains text[];
  v_domain text;
  v_final text;
  v_edited boolean;
  v_base text; v_slug text; v_n int;
  v_first_slug text;
  v_identity_slug text;
  v_title text; v_body text; v_link text;
begin
  select is_admin into v_is_admin from public.profiles where id = v_caller;
  if not coalesce(v_is_admin, false) then raise exception 'Not authorized'; end if;

  select * into s from public.category_suggestions where id = p_suggestion_id;
  if s.id is null then raise exception 'Suggestion not found'; end if;
  if s.status <> 'pending' then raise exception 'Already decided'; end if;

  v_final := coalesce(nullif(btrim(p_name), ''), s.name);
  v_edited := lower(v_final) <> lower(s.name);

  v_domains := coalesce(p_domains, array[s.domain]);
  if coalesce(array_length(v_domains, 1), 0) = 0 then v_domains := array[s.domain]; end if;

  foreach v_domain in array v_domains loop
    if v_domain not in ('good', 'service', 'place', 'identity') then
      raise exception 'Unknown domain: %', v_domain;
    end if;

    -- Reuse a same-name category already in this domain, else mint one —
    -- under the FINAL name, which is the suggestion's unless edited.
    select id into v_slug from public.categories
      where domain = v_domain and lower(name) = lower(v_final) limit 1;
    if v_slug is null then
      v_base := left(v_domain, 1) || '_' || regexp_replace(lower(v_final), '[^a-z0-9]+', '_', 'g');
      v_base := trim(both '_' from v_base);
      if v_base = '' or v_base = left(v_domain, 1) || '_' then v_base := left(v_domain, 1) || '_custom'; end if;
      v_slug := v_base; v_n := 0;
      while exists (select 1 from public.categories where id = v_slug) loop
        v_n := v_n + 1;
        v_slug := v_base || '_' || v_n;
      end loop;
      insert into public.categories (id, domain, name, sort)
      values (v_slug, v_domain, v_final, 1000);
    end if;
    if v_first_slug is null then v_first_slug := v_slug; end if;
    if v_domain = 'identity' and v_identity_slug is null then v_identity_slug := v_slug; end if;

    -- AS-IS keeps the auto-add; an EDITED name is the proposer's to choose —
    -- a first-person identity is declared, never presumed (the Economic
    -- step's own rule).
    if not v_edited then
      if v_domain = 'identity' then
        update public.profiles
          set identity_tags = case
            when coalesce(identity_tags, '{}') @> array[v_final] then identity_tags
            else coalesce(identity_tags, '{}') || v_final
          end
          where id = s.proposer_id;
      else
        insert into public.profile_categories (profile_id, category_id)
        values (s.proposer_id, v_slug)
        on conflict do nothing;
      end if;
    end if;
  end loop;

  update public.category_suggestions
    set status = 'approved', category_id = v_first_slug, decided_at = now(), decided_by = v_caller
    where id = p_suggestion_id;

  if v_identity_slug is not null then v_link := '/identities/' || v_identity_slug;
  else v_link := '/profile#offer'; end if;

  if v_edited then
    v_title := 'Your suggestion “' || s.name || '” was woven in as “' || v_final || '”';
    v_body := case when v_identity_slug is not null
      then 'If it fits, open its page and add it to your identities — your call.'
      else 'It''s in the vocabulary now — add it to what you offer from your profile if it fits.' end;
  else
    v_title := 'Your suggestion “' || v_final || '” was approved';
    v_body := case when v_identity_slug is not null
      then 'It''s in the vocabulary and on your identities now.'
      else 'It''s in the vocabulary and on your profile now.' end;
  end if;

  perform public.notify(s.proposer_id, 'profile', null, 'suggestion_decided', v_title, v_body, v_link, v_caller);
end;
$func$;

revoke all on function public.approve_category_suggestion(uuid, text[], text) from public, anon;
grant execute on function public.approve_category_suggestion(uuid, text[], text) to authenticated;

-- 2) "Same as…" now stamps who decided (it never did) and bells the
--    proposer with the category their word landed under — identity targets
--    link the gathering, where adding it is their own choice.
create or replace function public.alias_category_suggestion(p_suggestion uuid, p_category text)
returns void language plpgsql security definer set search_path to 'public' as $func$
declare
  s public.category_suggestions;
  c public.categories;
  v_link text; v_body text;
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'Admins only.';
  end if;
  select * into c from public.categories where id = p_category;
  if c.id is null then raise exception 'No such category.'; end if;
  select * into s from public.category_suggestions where id = p_suggestion;
  if s.id is null then raise exception 'No such suggestion.'; end if;

  insert into public.category_aliases (alias, category_id, created_by)
  values (lower(btrim(s.name)), p_category, auth.uid())
  on conflict (alias) do update set category_id = excluded.category_id;

  update public.category_suggestions
    set status = 'approved', category_id = p_category, decided_at = now(), decided_by = auth.uid()
    where id = p_suggestion;

  if c.domain = 'identity' then
    v_link := '/identities/' || c.id;
    v_body := 'If it fits, open its page and add “' || c.name || '” to your identities — your call.';
  else
    v_link := '/profile#offer';
    v_body := 'Searching for your word finds “' || c.name || '” now — add it to what you offer if it fits.';
  end if;

  perform public.notify(s.proposer_id, 'profile', null, 'suggestion_decided',
    'Your suggestion “' || s.name || '” now lives under “' || c.name || '”',
    v_body, v_link, auth.uid());
end $func$;

-- 3) Reject speaks too — silence was the failure.
create or replace function public.reject_category_suggestion(p_suggestion_id uuid) returns void
language plpgsql security definer set search_path to 'public' as $func$
declare
  v_caller uuid := auth.uid();
  v_is_admin boolean;
  s public.category_suggestions;
begin
  select is_admin into v_is_admin from public.profiles where id = v_caller;
  if not coalesce(v_is_admin, false) then raise exception 'Not authorized'; end if;
  select * into s from public.category_suggestions where id = p_suggestion_id;
  if s.id is null or s.status <> 'pending' then return; end if;
  update public.category_suggestions
    set status = 'rejected', decided_at = now(), decided_by = v_caller
    where id = p_suggestion_id;
  perform public.notify(s.proposer_id, 'profile', null, 'suggestion_decided',
    'About your suggestion “' || s.name || '”',
    'It didn''t join the vocabulary this time — thank you for offering it.',
    null, v_caller);
end $func$;
