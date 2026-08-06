-- YOU DON'T RECOMMEND A PERSON — YOU RECOMMEND THEIR WORK (founder 2026-08-06:
-- "trust is person to person... recommend is person to org, org to org...
-- retire recommending a profile").
--
-- Trust attaches to the being; recommend attaches to the offering. That single
-- split dissolves the muddle where one thumb had to mean both "I vouch for
-- this human" and "their somatic therapy is good" — and it stops a general
-- recommend implicitly endorsing everything someone has ever listed.
--
-- GRANULARITY IS THE PROVIDER'S, NEVER THE RECOMMENDER'S: you can only tag
-- what they themselves listed. If Galyn lists 'Somatic therapy' that's the
-- unit; if she lists plain 'Therapy' that's the unit. So the taxonomy can grow
-- as deep as it likes without ever making a recommendation harder to give.
--
-- Existing rows are KEPT, untagged — they read as "recommended generally".
-- Nothing is deleted.

alter table public.recommendations
  add column if not exists offering_category text references public.categories(id) on delete cascade;

-- One recommendation per (me → them → this offering). The old primary key
-- allowed one row per target, which would have collapsed two offerings from
-- the same provider into one.
do $$ begin
  alter table public.recommendations drop constraint if exists recommendations_pkey;
exception when others then null; end $$;

create unique index if not exists recommendations_unique_idx
  on public.recommendations (recommender_id, target_type, target_id,
                             coalesce(offering_category, ''));

create index if not exists recommendations_offering_idx
  on public.recommendations (target_id, offering_category)
  where offering_category is not null;

-- A tagged recommendation must name something the provider actually offers,
-- and only makes sense on a person.
create or replace function public.check_offering_recommend() returns trigger
language plpgsql as $func$
begin
  if new.offering_category is null then return new; end if;
  if new.target_type <> 'profile' then
    raise exception 'Only a person''s offerings can be recommended by category.';
  end if;
  if not exists (
    select 1 from public.profile_categories pc
    where pc.profile_id = new.target_id and pc.category_id = new.offering_category
  ) then
    raise exception 'They don''t list that offering.';
  end if;
  return new;
end $func$;

drop trigger if exists recommendations_check_offering on public.recommendations;
create trigger recommendations_check_offering
  before insert or update on public.recommendations
  for each row execute function public.check_offering_recommend();
