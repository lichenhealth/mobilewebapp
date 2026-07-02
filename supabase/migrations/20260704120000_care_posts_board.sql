-- =============================================================================
-- Concierge redesign: unified care_posts board for WOW (Web of Wellbeing) + KOC
-- (daily care plan), replacing health_snapshots / care_plans / care_plan_items.
--
-- One table, discriminated by `kind`:
--   'wow' → a scored (0–100) post tagged "All" (empty dimensions) or with 1+ of
--           the six wellbeing dimensions. The radar is derived from these scores.
--   'koc' → a post scheduled to a day or date range (start_date..end_date).
--
-- Reuses the SECURITY DEFINER helpers is_on_care_team / is_active_caregiver and
-- touch_updated_at (from 20260702120000 / init.sql). Read = anyone on the care
-- team; write = an active caregiver (author-only edit). Media lives in a private
-- `care-media` bucket, gated by care-team membership.
--
-- NOT auto-applied. Run in the Supabase SQL editor, then refresh the init.sql
-- baseline with pg_dump. Idempotent. The old snapshot/plan tables are left in
-- place (dormant) and can be dropped in a later cleanup migration.
-- =============================================================================

create table if not exists public.care_posts (
  id          uuid primary key default gen_random_uuid(),
  patient_id  uuid not null references public.profiles(id) on delete cascade,
  author_id   uuid not null references public.profiles(id),
  kind        text not null check (kind in ('wow', 'koc')),
  body        text not null default '',
  dimensions  text[] not null default '{}'::text[],   -- WOW sub-tags; empty = "All"; KOC = {}
  score       smallint check (score between 0 and 100), -- WOW: required; KOC: null
  start_date  date,                                     -- KOC: span start; WOW: null
  end_date    date,                                     -- KOC: span end;   WOW: null
  attachments jsonb not null default '[]'::jsonb,       -- [{ type:'photo'|'video'|'audio', path }]
  links       jsonb not null default '[]'::jsonb,       -- [{ label, url, internal }]
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  -- WOW carries a score and no dates; KOC carries an ordered span, no score/dimensions.
  constraint care_posts_kind_shape check (
    (kind = 'wow' and score is not null and start_date is null and end_date is null)
    or
    (kind = 'koc' and score is null and start_date is not null and end_date is not null
       and end_date >= start_date and cardinality(dimensions) = 0)
  ),
  constraint care_posts_dims_valid check (
    dimensions <@ array['Mental','Physical','Spiritual','Social','Environmental','Economic']::text[]
  ),
  constraint care_posts_nonempty check (
    length(btrim(body)) > 0
    or jsonb_array_length(attachments) > 0
    or jsonb_array_length(links) > 0
  )
);

alter table public.care_posts enable row level security;

create index if not exists care_posts_wow_idx
  on public.care_posts (patient_id, created_at desc) where kind = 'wow';
create index if not exists care_posts_koc_range_idx
  on public.care_posts (patient_id, start_date, end_date) where kind = 'koc';
create index if not exists care_posts_dims_gin
  on public.care_posts using gin (dimensions) where kind = 'wow';

drop trigger if exists care_posts_touch on public.care_posts;
create trigger care_posts_touch before update on public.care_posts
  for each row execute function public.touch_updated_at();

drop policy if exists "care_posts read"   on public.care_posts;
drop policy if exists "care_posts insert" on public.care_posts;
drop policy if exists "care_posts update" on public.care_posts;
drop policy if exists "care_posts delete" on public.care_posts;

create policy "care_posts read" on public.care_posts for select to authenticated
  using (public.is_on_care_team(patient_id, auth.uid()));
create policy "care_posts insert" on public.care_posts for insert to authenticated
  with check (author_id = auth.uid() and public.is_active_caregiver(patient_id, auth.uid()));
create policy "care_posts update" on public.care_posts for update to authenticated
  using (public.is_active_caregiver(patient_id, auth.uid()))
  with check (author_id = auth.uid() and public.is_active_caregiver(patient_id, auth.uid()));
create policy "care_posts delete" on public.care_posts for delete to authenticated
  using (public.is_active_caregiver(patient_id, auth.uid()));

-- ── Private care-media bucket (mirror chat-media; path <patient_id>/<file>) ───
insert into storage.buckets (id, name, public)
values ('care-media', 'care-media', false)
on conflict (id) do nothing;

drop policy if exists "care-media: team read"        on storage.objects;
drop policy if exists "care-media: caregiver upload" on storage.objects;
drop policy if exists "care-media: caregiver delete" on storage.objects;

create policy "care-media: team read"
  on storage.objects for select to authenticated
  using (bucket_id = 'care-media'
         and public.is_on_care_team(((storage.foldername(name))[1])::uuid, auth.uid()));

create policy "care-media: caregiver upload"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'care-media'
             and public.is_active_caregiver(((storage.foldername(name))[1])::uuid, auth.uid()));

create policy "care-media: caregiver delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'care-media'
         and public.is_active_caregiver(((storage.foldername(name))[1])::uuid, auth.uid()));
