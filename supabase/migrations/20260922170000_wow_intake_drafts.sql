-- REAL-TIME INTAKE AUTOSAVE (founder 2026-09-22: toggling away from the
-- self assessment lost an unwoven answer — "can we make auto-save real
-- time? So I don't lose work in the future and my members don't, either").
-- One draft row per member holding everything typed but not yet woven,
-- plus where they were — the page_drafts pattern, its own table because a
-- draft is unfinished words and gets the platform's default-hidden stance:
-- owner-only RLS, no care-team read, and NO assistant path reads it, ever
-- (a draft may hold words the member will mark "keep out of AI" at weave
-- time — the hold-back must be decidable before anything else can read).
create table if not exists public.wow_intake_drafts (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  draft jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.wow_intake_drafts enable row level security;
drop policy if exists "wow_intake_drafts own" on public.wow_intake_drafts;
create policy "wow_intake_drafts own" on public.wow_intake_drafts
  for all using (profile_id = auth.uid()) with check (profile_id = auth.uid());
