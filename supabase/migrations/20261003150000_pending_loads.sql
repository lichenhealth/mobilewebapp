-- PENDING LOADS (founder 2026-10-02: "Why don't we have it listed as a
-- pending input, kinda like a checking account - with an estimated arrival
-- time - kinda like venmo"): a bank load is money IN TRANSIT — charged at
-- the member's bank, not yet cleared, so no Current exists yet (the float
-- rule). This table is the wallet's record of that in-between: written by
-- the stripe-webhook when a bank checkout completes (payment processing),
-- flipped to 'landed' when the async confirmation mints the Current, or
-- 'failed' if the bank returns the debit. Display-only — the MINT still
-- rides record_currentcy_load's own idempotency; this row never creates a
-- single Current.
--
-- RLS: the owner reads their own rows; NO client writes (no insert/update
-- policy) — only the webhook's service role records money in transit.

create table if not exists public.pending_loads (
  id                uuid primary key default gen_random_uuid(),
  profile_id        uuid not null references public.profiles(id) on delete cascade,
  stripe_session_id text not null unique,
  amount_cents      integer not null check (amount_cents > 0),
  status            text not null default 'pending'
                    check (status in ('pending', 'landed', 'failed')),
  created_at        timestamptz not null default now(),
  resolved_at       timestamptz
);

alter table public.pending_loads enable row level security;
drop policy if exists "pending loads: own" on public.pending_loads;
create policy "pending loads: own" on public.pending_loads
  for select using (profile_id = auth.uid());
grant select on public.pending_loads to authenticated;
