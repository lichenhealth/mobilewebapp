// Supabase Edge Function: calendar-feed
//
// YOUR LICHEN CALENDAR, IN GOOGLE (founder 2026-11-02: "I want to see my
// Lichen cal on my google cal as well as seeing my google cal on my lichen
// cal (already)"): serves a member's calendar as a standing ICS feed that
// Google / Apple / Outlook subscribe to by URL — the OUTBOUND mirror of the
// secret-URL ICS import.
//
// verify_jwt is OFF: the unguessable token IS the authorization (the
// guest_token pattern — calendar readers can't send JWTs). A missing or
// wrong token answers 404 with nothing else said.
//
// WHAT RIDES OUT — events only: the member's own events plus their
// going/tentative RSVPs — and since 2026-11-13 pending INVITATIONS too, as
// STATUS:TENTATIVE, so an invite reaches the invitee's Google before they
// answer (the founder inviting Gabe to the vet visit). Confirmed bookings already live as provider-owned
// events with the booker seated as an attendee (_booking_attach_event), so
// sessions reach both parties with no double-count. Reminders/tasks and the
// care plan deliberately stay OUT of v1 — widening what leaves the platform
// is a founder call, not a default.
//
// TIMES: timed events emit DTSTART;TZID=<member's IANA zone> with local
// wall-clock times — the only shape that survives DST on recurring events.
// Bare IANA TZIDs (no VTIMEZONE block) are accepted by Google, Apple and
// Outlook in practice. All-day events ride as VALUE=DATE.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

import { esc, fold, plusDays, vevent, type Ev } from '../_shared/ics.ts';

async function sb(path: string): Promise<unknown> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SERVICE_KEY!, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  return r.ok ? r.json() : [];
}

Deno.serve(async (req) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return new Response('Method not allowed', { status: 405 });
  }
  if (!SUPABASE_URL || !SERVICE_KEY) return new Response('Not configured', { status: 500 });
  const token = new URL(req.url).searchParams.get('t') ?? '';
  if (!/^[0-9a-f]{32,128}$/.test(token)) return new Response('Not found', { status: 404 });

  const feed = (await sb(`calendar_feeds?token=eq.${token}&select=profile_id`)) as { profile_id: string }[];
  const me = feed?.[0]?.profile_id;
  if (!me) return new Response('Not found', { status: 404 });

  const prof = (await sb(`profiles?id=eq.${me}&select=full_name,timezone`)) as { full_name: string | null; timezone: string | null }[];
  const tz = prof?.[0]?.timezone || 'America/Denver';
  const name = prof?.[0]?.full_name || 'Lichen member';

  // Window: a couple of months back → ~13 months out; recurring events ride
  // regardless of age (their RRULE carries them forward).
  const today = new Date().toISOString().slice(0, 10);
  const lo = plusDays(today, -60);
  const hi = plusDays(today, 400);
  const COLS = 'id,title,description,location,start_date,end_date,all_day,start_min,end_min,recurrence';
  const [own, rsvp] = await Promise.all([
    sb(`events?owner_profile_id=eq.${me}&is_draft=not.is.true&select=${COLS}&start_date=lte.${hi}&or=(end_date.gte.${lo},start_date.gte.${lo},recurrence.not.is.null)&order=start_date&limit=1000`),
    sb(`event_attendees?profile_id=eq.${me}&status=in.(going,tentative,invited)&select=status,event:events(${COLS})&limit=1000`),
  ]);

  const byId = new Map<string, Ev>();
  for (const e of (own as Ev[] | null) ?? []) byId.set(e.id, e);
  for (const row of (rsvp as { status: string; event: Ev | null }[] | null) ?? []) {
    const e = row.event;
    if (!e || byId.has(e.id)) continue;
    if (e.start_date > hi || ((e.end_date ?? e.start_date) < lo && !e.recurrence)) continue;
    byId.set(e.id, { ...e, _tentative: row.status === 'tentative' || row.status === 'invited' });
  }

  const now = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const body = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Lichen//Calendar Feed//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    fold(`X-WR-CALNAME:${esc(`${name} · Lichen`)}`),
    fold(`X-WR-TIMEZONE:${tz}`),
    ...[...byId.values()].map((e) => vevent(e, tz, now)),
    'END:VCALENDAR',
    '',
  ].join('\r\n');

  return new Response(req.method === 'HEAD' ? null : body, {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Cache-Control': 'private, max-age=300',
      'Content-Disposition': 'inline; filename="lichen.ics"',
    },
  });
});
