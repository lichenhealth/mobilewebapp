-- THE BUG BRIDGE (founder 2026-08-24: "any way to have the claude from the
-- chat work with you directly regarding bugs/issues, so I don't have to
-- relay the message back to you with screenshots?"). In-app assistants get
-- a file_dev_report tool: when a member reports something broken, Claude
-- files it HERE with the context it can see — and the builder Claude reads
-- this queue at the start of every terminal session (standing protocol in
-- CLAUDE.md). No bells, no member-facing surface: it is a workbench inbox.
create table public.dev_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  -- Where it was filed from: 'feed:<thread>' or 'chat:<kind>:<chat_id>'.
  via text not null,
  summary text not null,
  details text,
  status text not null default 'new' check (status in ('new', 'seen', 'fixed', 'not_a_bug')),
  created_at timestamptz not null default now(),
  seen_at timestamptz
);
alter table public.dev_reports enable row level security;
-- Writes come only through the assistants' service role; platform admins
-- may read and triage from the app someday. Members never browse the queue.
create policy "dev_reports: admins read" on public.dev_reports
  for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));
create policy "dev_reports: admins update" on public.dev_reports
  for update to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));
grant select, update on public.dev_reports to authenticated;
