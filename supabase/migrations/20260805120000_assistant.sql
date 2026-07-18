-- The assistant's ledger: one row per Claude API call, so the edge function
-- can enforce a per-member daily cap (spend control). Deny-all RLS — only the
-- service role (inside the assistant-search edge function) reads or writes.

create table public.assistant_queries (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.assistant_queries enable row level security;
-- no policies on purpose: invisible to clients, service-role only

create index assistant_queries_profile_time
  on public.assistant_queries (profile_id, created_at desc);
