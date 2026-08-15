-- A WAY BACK TO THE SOURCE (founder 2026-08-14): an imported block says
-- "edit it there" but gave you no door to there. Google's API hands back a
-- direct per-event link (htmlLink) — we simply weren't asking for it — and
-- ICS files may carry a URL property. Store whichever we get; the event
-- popup turns it into "Open in Google Calendar".

alter table public.external_busy add column source_url text;

comment on column public.external_busy.source_url is
  'Direct link to this event in the calendar it came FROM (Google htmlLink, or an ICS URL property). Null when the source offers none — the client then falls back to that day in the source calendar.';
