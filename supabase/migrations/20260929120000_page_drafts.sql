-- DRAFT AND PUBLISH (founder 2026-08-29: "i like the draft and publish, which
-- is what things like squarespace do, let's build it").
--
-- The page builder held its work in the browser and wrote the whole live row
-- on Save. Two costs: anything unsaved died with the tab, and a stale form
-- could overwrite an edit Claude had made in the chat. A draft fixes both —
-- the builder autosaves here continuously and the live columns only change
-- when someone presses Publish.
--
-- WHY ITS OWN TABLE, not a page_draft column on spaces/profiles: a space row
-- is readable by anyone who can see the space, and Postgres grants are
-- column-level but not row-level — there is no way to expose a draft to its
-- stewards alone from a column on a publicly-readable row. Unpublished words
-- are exactly the words that must not leak, so they live somewhere with their
-- own RLS.
create table if not exists public.page_drafts (
  subject_type text not null check (subject_type in ('space', 'profile')),
  subject_id   uuid not null,
  -- { page, description?, contact? } — whatever that editor manages. Shapes
  -- differ between a space and a member, so the draft carries its own.
  draft        jsonb not null,
  -- What the draft was branched from, so Publish can tell whether the live
  -- page moved underneath it (Claude still writes straight to live).
  base         jsonb not null default '{}'::jsonb,
  updated_at   timestamptz not null default now(),
  updated_by   uuid references public.profiles(id) on delete set null,
  primary key (subject_type, subject_id)
);

alter table public.page_drafts enable row level security;

-- A draft belongs to whoever may publish it: the member themselves, or a
-- steward of the space. Not its members, not the open web.
create or replace function public.may_edit_page_draft(p_type text, p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when auth.uid() is null then false
    when p_type = 'profile' then p_id = auth.uid()
    when p_type = 'space'   then public.is_space_admin(p_id, auth.uid())
    else false
  end;
$$;

drop policy if exists page_drafts_rw on public.page_drafts;
create policy page_drafts_rw on public.page_drafts
  for all
  using (public.may_edit_page_draft(subject_type, subject_id))
  with check (public.may_edit_page_draft(subject_type, subject_id));

create index if not exists page_drafts_subject_idx
  on public.page_drafts (subject_type, subject_id);
