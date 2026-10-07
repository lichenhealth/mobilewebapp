-- UNIQUE ZOOM MEETING PER BOOKING (founder 2026-10-07: "walk me thru how to
-- do this with zoom, yes!" — the endgame of the 2026-10-06 video-link ship).
-- A booking type may now ask for a FRESH Zoom meeting minted for every
-- confirmed booking, instead of (or as well as) a standing personal link —
-- so nobody can ever bop into a room that was booked for someone else, and
-- a cancelled booking's door actually closes.
--
-- The minting itself happens in the `zoom-meeting` edge function (Zoom
-- Server-to-Server OAuth on Lichen's own Zoom account — the founder's
-- "Lichen Scheduling" Marketplace app; secrets ZOOM_ACCOUNT_ID /
-- ZOOM_CLIENT_ID / ZOOM_CLIENT_SECRET, founder-pasted). This migration is
-- the data half:
--
-- 1. booking_type_meetings.zoom_unique — the per-type opt-in. The url goes
--    nullable: a row may be a standing link, the unique-Zoom flag, or both
--    (the standing link is then the fallback if minting ever fails —
--    _booking_attach_event's already-stamped-wins coalesce was built for
--    exactly this).
-- 2. bookings.zoom_meeting_id — the minted meeting's Zoom id, so a
--    reschedule PATCHes the meeting's time and a cancellation DELETEs the
--    meeting (real revocation, the thing a standing link can never do).
-- 3. platform_settings.zoom_providers — WHICH providers may mint on
--    Lichen's Zoom account (today: Galyn). Deliberately a short list: all
--    meetings are hosted by the one Lichen Zoom user, and most Zoom plans
--    allow only ONE live meeting per host at a time — opening this to every
--    provider would let two providers' 3pm sessions fight over the line.
--    Other providers connecting their OWN Zoom needs a published OAuth app
--    (Zoom review) — a later chapter.
-- 4. A trigger on bookings that pokes the edge function (pg_net, the
--    tick_booking_reminders idiom) whenever a zoom_unique booking is
--    confirmed, rescheduled, or cancelled. The function RECONCILES to the
--    row's current state — mint / re-time / delete — so a replayed or
--    doubled poke can only restate the truth.

-- ── 1+2. Schema ──────────────────────────────────────────────────────────────

alter table public.booking_type_meetings
  add column if not exists zoom_unique boolean not null default false;

alter table public.booking_type_meetings alter column url drop not null;

alter table public.booking_type_meetings
  drop constraint if exists booking_type_meetings_url_shape;
alter table public.booking_type_meetings
  add constraint booking_type_meetings_url_shape
  check (url is null or (url ~* '^https://[^[:space:]]+$' and length(url) <= 500));

-- A row must SAY something: a standing link, the unique-Zoom ask, or both.
alter table public.booking_type_meetings
  drop constraint if exists booking_type_meetings_says_something;
alter table public.booking_type_meetings
  add constraint booking_type_meetings_says_something
  check (url is not null or zoom_unique);

alter table public.bookings
  add column if not exists zoom_meeting_id text;

-- ── 3. Who may mint on Lichen's Zoom ────────────────────────────────────────

insert into public.platform_settings (key, value)
values ('zoom_providers', '["1c01a063-5b05-41bb-ad61-916d7e454dbf"]'::jsonb)
on conflict (key) do update set value = excluded.value;

-- ── 4. The poke: booking state changed → reconcile its Zoom meeting ─────────

create or replace function public.poke_zoom_meeting()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $func$
declare v_secret text; v_zoom boolean;
begin
  -- Only types that asked for unique meetings, and only state changes the
  -- meeting cares about. The edge function re-derives everything from the
  -- row, so firing twice is harmless.
  select m.zoom_unique into v_zoom
    from public.booking_type_meetings m where m.type_id = new.type_id;
  if not coalesce(v_zoom, false) then return new; end if;
  if not (new.status = 'confirmed'
          or (new.status in ('cancelled', 'declined') and new.zoom_meeting_id is not null)) then
    return new;
  end if;

  begin
    select decrypted_secret into v_secret
      from vault.decrypted_secrets where name = 'push_hook_secret';
    perform net.http_post(
      url := 'https://mjqnaevertyzgjlpwynr.supabase.co/functions/v1/zoom-meeting',
      headers := jsonb_build_object('Content-Type', 'application/json',
                                    'x-webhook-secret', coalesce(v_secret, '')),
      body := jsonb_build_object('booking_id', new.id));
  exception when others then
    null;  -- a poke hiccup must never block the booking itself
  end;
  return new;
end;
$func$;
revoke all on function public.poke_zoom_meeting() from public, anon, authenticated;

-- `update of` those columns only: the edge function's own stamp writes
-- meeting_url/zoom_meeting_id, which are NOT listed — no echo loop.
drop trigger if exists booking_zoom_poke on public.bookings;
create trigger booking_zoom_poke
  after insert or update of status, on_date, start_min, end_min on public.bookings
  for each row execute function public.poke_zoom_meeting();
