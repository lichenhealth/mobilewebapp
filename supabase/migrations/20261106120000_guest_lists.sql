-- REUSABLE GUEST LISTS (founder 2026-11-05/06: "save the guest list … like
-- paperless post" → "build the reusable guest lists next"). A member's
-- private address book of invitees: members, emails and phones exactly as
-- Compose's Who's-invited chips hold them, plus any whole circles. Owner-only
-- by construction — nobody else (no assistant either) ever reads a list.
create table if not exists public.guest_lists (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  entries jsonb not null default '[]'::jsonb check (jsonb_typeof(entries) = 'array'),
  space_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists guest_lists_owner_name
  on public.guest_lists (owner_id, lower(btrim(name)));
alter table public.guest_lists enable row level security;
drop policy if exists "guest_lists owner" on public.guest_lists;
create policy "guest_lists owner" on public.guest_lists
  for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
grant select, insert, update, delete on public.guest_lists to authenticated;
