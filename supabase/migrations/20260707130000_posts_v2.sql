-- =============================================================================
-- Posts v2 — multi-audience, multiple service areas ("Where"), acting-as author.
--
-- NOT auto-applied. Run in the Supabase SQL editor, then refresh the init.sql
-- baseline with pg_dump. Idempotent.
--
-- posts is LIVE, so this is TRANSITION-SAFE: additive columns + a bridge
-- trigger keep the currently-deployed frontend working between running this
-- SQL and deploying the new frontend. Legacy columns (visibility, space_id,
-- service_area) stay populated for old readers; drop them in a later cleanup
-- once no deployed client reads them.
--
-- New model:
--   is_public / to_mycelium / audience_space_ids[]  — any combination
--     (Everyone is the UI-exclusive option; DB just requires ≥1 audience).
--   service_areas[]  — a post can be Courses AND Marketplace; the card shows
--     every icon.
--   author_space_id  — posted AS an org/community/group/place the author
--     admins ("acting as"); display attribution is the space.
-- =============================================================================

-- ── Helper: space admin? (mirrors is_space_member) ───────────────────────────
create or replace function public.is_space_admin(p_space uuid, p_uid uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from public.space_members m
                 where m.space_id = p_space and m.profile_id = p_uid
                   and m.role in ('admin', 'super_admin'));
$$;
alter function public.is_space_admin(uuid, uuid) owner to postgres;

-- ── New columns ───────────────────────────────────────────────────────────────
alter table public.posts add column if not exists service_areas text[] not null default '{}'::text[];
alter table public.posts add column if not exists is_public boolean not null default false;
alter table public.posts add column if not exists to_mycelium boolean not null default false;
alter table public.posts add column if not exists audience_space_ids uuid[] not null default '{}'::uuid[];
alter table public.posts add column if not exists author_space_id uuid references public.spaces(id) on delete set null;

alter table public.posts drop constraint if exists posts_service_areas_valid;
alter table public.posts add constraint posts_service_areas_valid check (
  service_areas <@ array['marketplace','work','courses','food','art','events','places','library','people']::text[]
);

create index if not exists posts_service_areas_gin on public.posts using gin (service_areas);
create index if not exists posts_audience_spaces_gin on public.posts using gin (audience_space_ids);
create index if not exists posts_author_space_idx on public.posts (author_space_id) where author_space_id is not null;

-- ── Backfill existing rows into the new model ────────────────────────────────
update public.posts set
  service_areas = case when service_area is not null and service_areas = '{}' then array[service_area] else service_areas end,
  is_public = (visibility = 'public'),
  to_mycelium = (visibility = 'mycelium'),
  audience_space_ids = case when visibility = 'space' and space_id is not null and audience_space_ids = '{}'::uuid[]
                            then array[space_id] else audience_space_ids end
where (is_public = false and to_mycelium = false and audience_space_ids = '{}'::uuid[]);

-- ── Bridge trigger: old FE ↔ new columns, both directions ────────────────────
create or replace function public.posts_audience_sync()
returns trigger language plpgsql as $$
begin
  if new.is_public = false and new.to_mycelium = false and new.audience_space_ids = '{}'::uuid[] then
    -- Old frontend: only `visibility` set → derive the new columns.
    new.is_public := (new.visibility = 'public');
    new.to_mycelium := (new.visibility = 'mycelium');
    if new.visibility = 'space' and new.space_id is not null then
      new.audience_space_ids := array[new.space_id];
    end if;
  else
    -- New frontend → keep legacy columns coherent (and their CHECKs satisfied).
    new.visibility := case when new.is_public then 'public'
                           when new.to_mycelium then 'mycelium'
                           else 'space' end;
    if new.visibility = 'space' and new.space_id is null then
      new.space_id := new.audience_space_ids[1];
    end if;
  end if;
  if new.service_areas = '{}' and new.service_area is not null then
    new.service_areas := array[new.service_area];
  elsif new.service_area is null and cardinality(new.service_areas) > 0 then
    new.service_area := new.service_areas[1];
  end if;
  return new;
end; $$;
alter function public.posts_audience_sync() owner to postgres;
drop trigger if exists posts_audience_sync_trg on public.posts;
create trigger posts_audience_sync_trg before insert on public.posts
  for each row execute function public.posts_audience_sync();

-- ── Policies (new-model reads; inserts validate audiences + acting) ──────────
drop policy if exists "posts: read" on public.posts;
create policy "posts: read" on public.posts for select to authenticated using (
  is_public
  or author_id = auth.uid()
  or (to_mycelium and exists (
        select 1 from public.mycelium my
        where my.truster_id = auth.uid()
          and ((my.target_type = 'profile' and my.target_id = posts.author_id)
            or (my.target_type = 'space' and my.target_id = posts.author_space_id))))
  or exists (
        select 1 from public.space_members m
        where m.profile_id = auth.uid() and m.space_id = any(posts.audience_space_ids))
);

drop policy if exists "posts: insert own" on public.posts;
create policy "posts: insert own" on public.posts for insert to authenticated with check (
  author_id = auth.uid()
  -- at least one audience once the trigger has bridged legacy inserts
  and (is_public or to_mycelium or cardinality(audience_space_ids) > 0)
  -- may only address spaces you belong to
  and not exists (
        select 1 from unnest(audience_space_ids) as a(sid)
        where not exists (select 1 from public.space_members m
                          where m.space_id = a.sid and m.profile_id = auth.uid()))
  -- posting AS a space requires adminship of it
  and (author_space_id is null or public.is_space_admin(author_space_id, auth.uid()))
);
