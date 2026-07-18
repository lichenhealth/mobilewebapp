-- Pinned calendar overlays, synced across devices (founder, 2026-07-17).
-- A pin references a person or space whose calendar the member layers onto
-- their own; what the overlay RENDERS stays per-viewer consent (free_busy /
-- calendar_shares) — the pin is just the bookmark. Owner-only RLS.

create table public.calendar_pins (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  target_kind text not null check (target_kind in ('profile', 'space')),
  target_id uuid not null,
  name text not null default '',
  created_at timestamptz not null default now(),
  unique (profile_id, target_kind, target_id)
);

alter table public.calendar_pins enable row level security;

create policy "own calendar pins" on public.calendar_pins
  for all to authenticated
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());
