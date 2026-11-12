-- Practice payments + superbills (founder 2026-11-12): a provider imports
-- their payment processor's activity export (Ivy Pay first), keys each
-- client id to a person once, and generates superbills from the sessions.
-- Everything here is OWNER-ONLY: nobody else, no assistant, reads it.
-- Diagnosis codes are deliberately NOT stored (typed at generation).

create table if not exists public.practice_settings (
  owner_id uuid primary key references public.profiles(id) on delete cascade,
  info jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.practice_clients (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  source text not null default 'ivy' check (source in ('ivy','manual')),
  external_id text not null,
  label text check (label is null or length(label) <= 120),
  member_id uuid references public.profiles(id) on delete set null,
  cpt text check (cpt is null or length(cpt) <= 12),
  service text check (service is null or length(service) <= 120),
  rate_cents int check (rate_cents is null or rate_cents between 0 and 1000000),
  notes text check (notes is null or length(notes) <= 500),
  created_at timestamptz not null default now(),
  unique (owner_id, source, external_id)
);

create table if not exists public.practice_payments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  source text not null default 'ivy' check (source in ('ivy','manual')),
  ref_no text not null,
  external_client_id text not null,
  charged_on date,
  charged_time text,
  session_on date not null,
  session_time text,
  amount_cents int not null,
  fee_cents int not null default 0,
  net_cents int not null default 0,
  transfer_on date,
  cpt text check (cpt is null or length(cpt) <= 12),
  service text check (service is null or length(service) <= 120),
  imported_at timestamptz not null default now(),
  unique (owner_id, source, ref_no)
);
create index if not exists practice_payments_owner_session on public.practice_payments (owner_id, session_on);

create table if not exists public.practice_transfers (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  source text not null default 'ivy',
  ref text not null,
  sent_at text,
  sent_on date,
  amount_cents int not null,
  unique (owner_id, source, ref)
);

alter table public.practice_settings enable row level security;
alter table public.practice_clients enable row level security;
alter table public.practice_payments enable row level security;
alter table public.practice_transfers enable row level security;

do $do$
declare t text;
begin
  foreach t in array array['practice_settings','practice_clients','practice_payments','practice_transfers'] loop
    execute format('drop policy if exists "%1$s: owner" on public.%1$s', t);
    execute format('create policy "%1$s: owner" on public.%1$s for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid())', t);
    execute format('revoke all on public.%1$s from anon', t);
    execute format('grant select, insert, update, delete on public.%1$s to authenticated', t);
  end loop;
end
$do$;
