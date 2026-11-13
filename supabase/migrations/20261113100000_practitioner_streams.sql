-- PRACTITIONER REVENUE STREAMS (founder 2026-11-12: "when someone comes on the
-- platform, they can specify all the revenue streams they make and what
-- subsidies they'd need to supplement covered stuff to make it feasible for
-- them… either the person can pay the delta over their coverage, or… the
-- practitioner can submit the subsidy request to the well").
-- A practitioner's OWN business facts, never client data: for each service,
-- the rate that makes the work feasible, and what each payer covers — a
-- fixed amount (Medi-Cal pays $80) or a share (out-of-network reimburses 70%).
-- Owner-only. The care-plan "How is this paid?" box reads them to pre-shape
-- an ask: covered = what the stream pays, the rest = the client's share or a
-- subsidy request.

create table if not exists public.practitioner_streams (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  service text not null check (char_length(service) between 1 and 80),
  rate_cents integer not null check (rate_cents between 100 and 1000000),
  label text not null check (char_length(label) between 1 and 60),
  kind text not null default 'other' check (kind in ('cash','sliding','insurance_in','insurance_out','public','contract','other')),
  pays_cents integer check (pays_cents between 0 and 1000000),
  pays_pct smallint check (pays_pct between 1 and 100),
  note text check (note is null or char_length(note) <= 200),
  sort smallint not null default 0,
  created_at timestamptz not null default now(),
  check (pays_cents is null or pays_pct is null)
);
create index if not exists practitioner_streams_owner on public.practitioner_streams(owner_id, service, sort);

alter table public.practitioner_streams enable row level security;
drop policy if exists "practitioner_streams: owner" on public.practitioner_streams;
create policy "practitioner_streams: owner" on public.practitioner_streams
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
revoke all on public.practitioner_streams from anon;
grant select, insert, update, delete on public.practitioner_streams to authenticated;
