-- ONE REPLY PER MESSAGE (founder 2026-11-09, "why do i have 3 drafts of
-- mom's bday zoom?" — one message was answered twice, four seconds apart,
-- and each reply ran draft_event; 14 doubled replies in the past 30 days).
-- assistant-feed claims the triggering row here before doing anything; a
-- second invocation for the same row finds the claim and stands down.
-- Service-role only — no client policy.
create table if not exists public.assistant_reply_claims (
  feed_post_id uuid primary key,
  claimed_at timestamptz not null default now()
);
alter table public.assistant_reply_claims enable row level security;
revoke all on public.assistant_reply_claims from anon, authenticated;
