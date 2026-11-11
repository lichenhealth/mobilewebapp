-- LICHEN MAIL (founder 2026-11-11: "let's create 'Mail' on Lichen and I can
-- test it for personal use"). Gmail accounts a member connects. Message
-- content is NEVER stored — every read is live from Google through the
-- mail-api edge function.

create table if not exists public.mail_accounts (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  email text not null,
  connected_at timestamptz not null default now(),
  last_error text
);
create unique index if not exists mail_accounts_one_per_email on public.mail_accounts (profile_id, lower(email));
alter table public.mail_accounts enable row level security;
drop policy if exists "mail accounts: owner reads" on public.mail_accounts;
create policy "mail accounts: owner reads" on public.mail_accounts for select using (profile_id = auth.uid());
revoke all on public.mail_accounts from anon;
-- Writes ride the edge functions (service role) only: connect = OAuth callback, disconnect = mail-oauth-start.

-- The refresh tokens: RLS on, NO policies, nothing granted — service role only.
create table if not exists public.mail_tokens (
  account_id uuid primary key references public.mail_accounts(id) on delete cascade,
  refresh_token text not null,
  access_token text,
  expires_at timestamptz
);
alter table public.mail_tokens enable row level security;
revoke all on public.mail_tokens from anon, authenticated;

-- Who may use Mail while it's a personal test (Google Testing mode caps at 100 named users).
insert into public.platform_settings (key, value)
values ('mail_testers', '["1c01a063-5b05-41bb-ad61-916d7e454dbf"]'::jsonb)
on conflict (key) do nothing;
