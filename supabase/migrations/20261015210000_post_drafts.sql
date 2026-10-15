-- POST DRAFTS (founder 2026-10-15: "can we have posts auto save and have a
-- save AND post button at the bottom, not just post, so we will also need a
-- drafts section"): Compose autosaves an unfinished post into one row here
-- (the page_drafts/wow_intake_drafts idiom — debounce + pagehide flush,
-- empty deletes the row, posting deletes the row). SEVERAL rows per member,
-- unlike page_drafts' one-per-subject: several posts can wait at once, and
-- the Drive's Drafts section lists them. The id is minted CLIENT-side
-- (crypto.randomUUID) so a compose session upserts the same row throughout.
-- Owner-only RLS — a draft is private by construction, and like
-- wow_intake_drafts NO assistant path may ever read it: posting is where a
-- member chooses what the network (and the AI fabric) sees.

create table if not exists public.post_drafts (
  id uuid primary key,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  draft jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists post_drafts_profile_idx
  on public.post_drafts (profile_id, updated_at desc);

alter table public.post_drafts enable row level security;

create policy "post_drafts own" on public.post_drafts
  for all using (profile_id = auth.uid()) with check (profile_id = auth.uid());

grant select, insert, update, delete on public.post_drafts to authenticated;
