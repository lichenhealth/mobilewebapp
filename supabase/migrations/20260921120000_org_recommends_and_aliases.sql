-- TWO THINGS THAT SHARE A MIGRATION (founder 2026-08-06: "let's do both").
--
-- 1. AN ORG CAN RECOMMEND. "Recommend is person to org, org to org, community
--    to org." recommendations.recommender_id referenced profiles(id), so only
--    a human could ever endorse anything. Countryman Stables recommending a
--    farrier is a real and different statement from Katie personally
--    recommending them.
--
--    TRUST STAYS PERSON-ONLY, deliberately. Trust is the private, ungameable,
--    person-by-person signal; an organization that can vouch at scale is an
--    organization that can be lobbied for its vouch. mycelium is untouched.
--
-- 2. CATEGORY ALIASES. 115 categories and a suggest-new flow that only ever
--    ADDS. Every new row makes the picker longer and search LESS precise: a
--    seeker filtering "Bodywork" misses whoever got filed under a freshly
--    minted "Structural Integration". Aliases let a member use their own words
--    while the filter list stays short — mapping becomes the default answer to
--    a suggestion, and minting a genuinely new category the rare deliberate
--    act it should be.

-- ── 1. Who may recommend ──────────────────────────────────────────────────
alter table public.recommendations
  add column if not exists recommender_space_id uuid references public.spaces(id) on delete cascade;

-- Exactly one voice per recommendation: a person OR a space they administer.
do $$ begin
  alter table public.recommendations add constraint recommendations_one_voice
    check (recommender_space_id is null or recommender_id is not null);
exception when duplicate_object then null; end $$;

-- The unique key has to include the space, or an org's endorsement would
-- collide with its admin's personal one.
drop index if exists public.recommendations_unique_idx;
create unique index recommendations_unique_idx
  on public.recommendations (recommender_id, coalesce(recommender_space_id::text, ''),
                             target_type, target_id, coalesce(offering_category, ''));

-- You may only speak for a space you administer, and never about itself.
create or replace function public.check_recommend_voice() returns trigger
language plpgsql as $func$
begin
  if new.recommender_space_id is null then return new; end if;
  if not public.is_space_admin(new.recommender_space_id, auth.uid()) then
    raise exception 'You don''t speak for that space.';
  end if;
  if new.target_type = 'space' and new.target_id = new.recommender_space_id then
    raise exception 'A space can''t recommend itself.';
  end if;
  return new;
end $func$;

drop trigger if exists recommendations_check_voice on public.recommendations;
create trigger recommendations_check_voice
  before insert or update on public.recommendations
  for each row execute function public.check_recommend_voice();

-- ── 2. Aliases: many words, one category ──────────────────────────────────
create table if not exists public.category_aliases (
  alias text primary key,
  category_id text not null references public.categories(id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null
);
alter table public.category_aliases enable row level security;

-- Readable by everyone: search needs them, and they carry no personal data.
create policy "aliases: readable" on public.category_aliases
  for select to authenticated, anon using (true);

create index if not exists category_aliases_cat_idx on public.category_aliases (category_id);

/** Resolve a word to a category — the id itself, an exact name, or an alias.
 *  Case- and space-insensitive so "structural integration" finds it. */
create or replace function public.resolve_category(p_word text)
returns text language sql stable security definer set search_path to 'public' as $func$
  select coalesce(
    (select c.id from public.categories c where c.id = lower(btrim(p_word))),
    (select c.id from public.categories c where lower(c.name) = lower(btrim(p_word))),
    (select a.category_id from public.category_aliases a where a.alias = lower(btrim(p_word)))
  );
$func$;
revoke all on function public.resolve_category(text) from public;
grant execute on function public.resolve_category(text) to authenticated, anon;

/** An admin answering a suggestion: map it onto an existing category instead
 *  of minting a new row. This is meant to be the DEFAULT answer. */
create or replace function public.alias_category_suggestion(p_suggestion uuid, p_category text)
returns void language plpgsql security definer set search_path to 'public' as $func$
declare v_name text;
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'Admins only.';
  end if;
  if not exists (select 1 from public.categories c where c.id = p_category) then
    raise exception 'No such category.';
  end if;
  select name into v_name from public.category_suggestions where id = p_suggestion;
  if v_name is null then raise exception 'No such suggestion.'; end if;

  insert into public.category_aliases (alias, category_id, created_by)
  values (lower(btrim(v_name)), p_category, auth.uid())
  on conflict (alias) do update set category_id = excluded.category_id;

  update public.category_suggestions set status = 'approved' where id = p_suggestion;
end $func$;
revoke all on function public.alias_category_suggestion(uuid, text) from public, anon;
grant execute on function public.alias_category_suggestion(uuid, text) to authenticated;
