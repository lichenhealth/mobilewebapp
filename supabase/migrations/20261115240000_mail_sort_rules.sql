-- LICHEN'S MAIL SORTING LEARNS FROM YOU (founder 2026-11-15: "the breyer horse
-- thing is a promotion, not an update - can we get smarter at filtering. how
-- can i help with that?"). A "Move to…" on any email stores the sender's tab
-- here; classifyMail reads these first. Owner-only — a member's own sorting.
create table if not exists public.mail_sort_rules (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  sender text not null check (sender ~ '^[^\s]{3,200}$'),   -- an address, or @domain
  kind text not null check (kind in ('primary','subscriptions','promotions','updates')),
  created_at timestamptz not null default now(),
  primary key (profile_id, sender)
);
alter table public.mail_sort_rules enable row level security;
drop policy if exists "mail sort rules: owner" on public.mail_sort_rules;
create policy "mail sort rules: owner" on public.mail_sort_rules
  for all to authenticated using (profile_id = auth.uid()) with check (profile_id = auth.uid());
revoke all on public.mail_sort_rules from anon;
