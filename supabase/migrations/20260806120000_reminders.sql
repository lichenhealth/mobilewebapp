-- REMINDERS (Gabe's suggestion, 2026-07-18): private calendar nudges — "Pay
-- rent on the 1st" — distinct from events on purpose: no guests, no RSVP, no
-- free_busy weight (a reminder never makes you look busy to anyone).
-- Recurrence reuses the platform's RRULE-lite jsonb (client expands with
-- occursOn). Owner-only RLS throughout.

create table public.reminders (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  start_date date not null,
  end_date date not null,                -- = start_date (Schedulable shape; series end lives in recurrence.end)
  at_min integer,                        -- minutes from midnight; null = day reminder (morning nudge)
  lead_min integer not null default 0,   -- alert this many minutes early
  recurrence jsonb,
  created_at timestamptz not null default now()
);

alter table public.reminders enable row level security;
create policy reminders_own on public.reminders
  for all using (profile_id = auth.uid()) with check (profile_id = auth.uid());
create index reminders_profile on public.reminders (profile_id, start_date);

-- Which occurrences are checked off ("done" on 2026-08-01 but the series lives on).
create table public.reminder_done (
  reminder_id uuid not null references public.reminders(id) on delete cascade,
  on_date date not null,
  primary key (reminder_id, on_date)
);

alter table public.reminder_done enable row level security;
create policy reminder_done_own on public.reminder_done
  for all using (exists (select 1 from public.reminders r where r.id = reminder_id and r.profile_id = auth.uid()))
  with check (exists (select 1 from public.reminders r where r.id = reminder_id and r.profile_id = auth.uid()));
