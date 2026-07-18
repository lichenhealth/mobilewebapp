-- The assistant's ledger: one row per Claude API call. Serves two purposes:
--  1. The edge function's per-member daily cap (spend control).
--  2. The SEED of Universal Value Attribution accounting for silicon
--     contributions — every AI act is recorded with its entity, context, and
--     exact token cost from day one, so "what has the assistant contributed,
--     for whom, at what cost" is a query, not an estimate. (Deck: Universal
--     Current-cy — "every contribution tracked and returned.")
-- Deny-all RLS — only the service role (inside assistant edge functions)
-- reads or writes.

create table public.assistant_queries (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  context text not null default 'search',   -- which surface asked: search | (later: care, booking, matcher…)
  model text,
  input_tokens integer,
  output_tokens integer,
  created_at timestamptz not null default now()
);

alter table public.assistant_queries enable row level security;
-- no policies on purpose: invisible to clients, service-role only

create index assistant_queries_profile_time
  on public.assistant_queries (profile_id, created_at desc);
