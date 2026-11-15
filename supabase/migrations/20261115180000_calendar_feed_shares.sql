-- SHARE YOUR LICHEN CALENDAR WITH SOMEONE (founder 2026-11-15: "make the
-- brain capable of messaging him via lichen chat, his cell or email the link
-- with the shared calendar… explain what he can see and have that reflected
-- in the settings"). Each person gets their OWN feed link, so one share can be
-- stopped without touching anyone else's, and each carries a detail level:
-- 'details' (titles, times, places, notes) or 'busy' (times only).
-- Per-event caps still apply inside a shared feed: share_level 'hidden' never
-- appears, 'busy' shows only as Busy. The owner's own feed is unchanged.
create table if not exists public.calendar_feed_shares (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  token text not null unique
    default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  recipient_profile_id uuid references public.profiles(id) on delete set null,
  recipient_name text not null check (char_length(recipient_name) between 1 and 120),
  recipient_email text check (recipient_email is null or char_length(recipient_email) <= 254),
  recipient_phone text check (recipient_phone is null or char_length(recipient_phone) <= 32),
  detail text not null default 'details' check (detail in ('details','busy')),
  channel text check (channel in ('chat','text','email','copy')),
  sent_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists calendar_feed_shares_owner on public.calendar_feed_shares(owner_id, created_at desc);

alter table public.calendar_feed_shares enable row level security;
drop policy if exists "feed shares: owner" on public.calendar_feed_shares;
create policy "feed shares: owner" on public.calendar_feed_shares
  for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
revoke all on public.calendar_feed_shares from anon;
grant select, insert, update, delete on public.calendar_feed_shares to authenticated;
