-- =============================================================================
-- Recommend ANYTHING — recommendations go polymorphic (post | profile | space).
--
-- NOT auto-applied. Run in the Supabase SQL editor. Idempotent.
-- ⚠ Run this IMMEDIATELY BEFORE merging the matching frontend: the column
--   rename breaks the OLD bundle's recommend reads/writes until the deploy
--   lands (minutes at beta scale).
--
-- "Recommend = amplify to the people who trust you" was always the model;
-- the table was just born post-only. This mirrors the mycelium table's
-- polymorphic target (target_type/target_id, no FK — orphans from deleted
-- targets are harmless and filtered by joins). Existing rows become
-- target_type='post' via the column default.
-- =============================================================================

do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'recommendations'
               and column_name = 'post_id') then
    alter table public.recommendations drop constraint if exists recommendations_pkey;
    alter table public.recommendations drop constraint if exists recommendations_post_id_fkey;
    alter table public.recommendations rename column post_id to target_id;
  end if;
end $$;

alter table public.recommendations add column if not exists target_type text not null default 'post'
  check (target_type in ('post', 'profile', 'space'));

do $$
begin
  if not exists (select 1 from pg_constraint
                 where conrelid = 'public.recommendations'::regclass and contype = 'p') then
    alter table public.recommendations add primary key (recommender_id, target_type, target_id);
  end if;
end $$;

drop index if exists public.recommendations_post_idx;
create index if not exists recommendations_target_idx
  on public.recommendations (target_type, target_id);

-- RLS policies (read all / add own / drop own) never referenced post_id —
-- they carry over unchanged.
