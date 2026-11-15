-- GOOGLE DRIVE → LICHEN DRIVE (founder 2026-11-15): remember what's already
-- been carried over, so the importer can say "On Lichen ✓" and never double up.
-- Owner-only; holds file NAMES and ids, never content.
create table if not exists public.gdrive_imports (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  account_email text not null,
  google_file_id text not null,
  name text not null,
  lichen_kind text not null,
  lichen_id uuid,
  imported_at timestamptz not null default now(),
  primary key (profile_id, google_file_id)
);
alter table public.gdrive_imports enable row level security;
create policy "gdrive_imports own read" on public.gdrive_imports for select to authenticated using (profile_id = auth.uid());
create policy "gdrive_imports own write" on public.gdrive_imports for insert to authenticated with check (profile_id = auth.uid());
create policy "gdrive_imports own update" on public.gdrive_imports for update to authenticated using (profile_id = auth.uid()) with check (profile_id = auth.uid());
create policy "gdrive_imports own delete" on public.gdrive_imports for delete to authenticated using (profile_id = auth.uid());
revoke all on public.gdrive_imports from anon;
