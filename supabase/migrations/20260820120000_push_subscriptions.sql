-- WEB PUSH (2026-07-22): phone lock-screen notifications, even when Lichen is
-- closed. A device subscribes once; its subscription lands here. A Database
-- Webhook on notifications INSERT calls the send-push edge function, which fans
-- each new bell out to the recipient's subscribed devices. So push rides the
-- existing notify() — every bell (nudges, DMs, care, gifts) reaches the phone.
--
-- Mirrors the send-notification-email webhook pattern exactly (same table, same
-- INSERT event) — this migration is just the storage; the webhook + secrets are
-- configured out-of-band (see the runbook).

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique,           -- the push service URL; unique per device
  p256dh text not null,                    -- subscription public key (payload encryption)
  auth text not null,                      -- subscription auth secret
  user_agent text,                         -- which device, for the member's own reference
  created_at timestamptz not null default now()
);
create index push_subscriptions_profile on public.push_subscriptions (profile_id);

alter table public.push_subscriptions enable row level security;

-- Owner-only: a member manages their own devices. The edge function reads with
-- the service role (bypasses RLS), so no broad read policy is needed.
create policy push_subs_own on public.push_subscriptions for all
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());
