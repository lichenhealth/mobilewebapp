-- EVERY GOOGLE CALENDAR + THE MULTI-DAY BAR (founder 2026-11-13, a screenshot
-- of Google's week with "Gabe on Shift" / "Gabe has Rowan" bars across the
-- top: "calendar events on google that are at the top bar because they're
-- multiple days aren't showing up - let's build a top bar like that on
-- lichen, as these are helpful ways my boyfriend and I coordinate care of his
-- daughter, our house, animals, etc").
-- Two gaps: the Google sync read ONLY the primary calendar (a shared family
-- calendar and the holidays calendar never arrived), and a multi-day event
-- was chopped into per-day blocks with nothing tying them together.
--
-- (1) external_calendars.sub_settings — every calendar on the connected
--     Google account, keyed by Google's calendar id:
--     {name, color, primary, include, busy}. include defaults to what's shown
--     in Google; busy defaults TRUE only for the primary calendar — someone
--     else's shift showing on your week must not block your bookable hours.
-- (2) Rows from a calendar marked busy land in external_busy as before (the
--     seven booking/free_busy functions read it — untouched). Rows from a
--     shown-but-not-busy calendar land in the NEW external_show table:
--     display only, owner-only, never read by any busy logic.
-- (3) Both carry the span: span_id (the event, across its days), span_start /
--     span_end dates and span_label ("Gabe on Shift, 9am"), plus sub_cal
--     (which Google calendar) and color, so the grid can draw one bar.

alter table public.external_calendars
  add column if not exists sub_settings jsonb not null default '{}'::jsonb;

alter table public.external_busy
  add column if not exists sub_cal text,
  add column if not exists color text,
  add column if not exists span_id text,
  add column if not exists span_start date,
  add column if not exists span_end date,
  add column if not exists span_label text;

create table if not exists public.external_show (
  id uuid primary key default gen_random_uuid(),
  calendar_id uuid not null references public.external_calendars(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  on_date date not null,
  all_day boolean not null default false,
  start_min integer,
  end_min integer,
  title text,
  source_url text,
  sub_cal text,
  color text,
  span_id text,
  span_start date,
  span_end date,
  span_label text
);
create index if not exists external_show_owner_day on public.external_show(profile_id, on_date);
create index if not exists external_show_cal on public.external_show(calendar_id);

alter table public.external_show enable row level security;
drop policy if exists "own external show" on public.external_show;
create policy "own external show" on public.external_show
  for all using (profile_id = auth.uid()) with check (profile_id = auth.uid());
revoke all on public.external_show from anon;
grant select, insert, update, delete on public.external_show to authenticated;
