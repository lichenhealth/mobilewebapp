-- THE SELF-DRIVING WINDOW (founder 2026-08-14, the same conversation that
-- fixed the window at 60): "let's allow humans to trust you automating it,
-- if/when that feels right. Kinda like self driving cars." The WOW score
-- window stays 60 days by default; a member may hand it to Claude, who tunes
-- it to the rhythm of their entries — always visible, always with a reason,
-- always revocable. This table holds that consent and its current outcome.
--
-- Per-patient care settings — one row per member, made as needed. RLS is the
-- financial_positions shape: the patient owns the row, the active care team
-- may read it (they render the same radar and need the same window).

create table public.care_settings (
  patient_id uuid primary key references public.profiles(id) on delete cascade,
  -- Claude's current pick. NULL (or auto off) = the platform default (60).
  wow_window_days smallint check (wow_window_days between 14 and 120),
  -- The consent switch: true = the member handed the window to Claude.
  wow_window_auto boolean not null default false,
  -- Claude's one-sentence explanation, shown verbatim to the member —
  -- a tuned window with no reason would be a hidden model again.
  wow_window_reason text,
  wow_window_set_at timestamp with time zone,
  updated_at timestamp with time zone not null default now()
);

alter table public.care_settings enable row level security;

create policy "care_settings own" on public.care_settings
  for all using (patient_id = auth.uid()) with check (patient_id = auth.uid());

create policy "care_settings care team read" on public.care_settings
  for select using (public.is_on_care_team(patient_id, auth.uid()));

grant select, insert, update, delete on public.care_settings to authenticated;
