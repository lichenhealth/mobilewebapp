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

interface Rec {
  freq: 'daily' | 'weekly' | 'monthly' | 'yearly';
  interval?: number;
  byday?: number[];                 // 0=Mon … 6=Sun
  monthMode?: 'date' | 'weekday';
  end?: { type: 'never' } | { type: 'until'; date: string } | { type: 'count'; n: number };
}
interface Ev {
  id: string; title: string | null; description: string | null; location: string | null;
  start_date: string; end_date: string | null; all_day: boolean;
  start_min: number | null; end_min: number | null; recurrence: Rec | null;
  _tentative?: boolean;
}

async function sb(path: string): Promise<unknown> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SERVICE_KEY!, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  return r.ok ? r.json() : [];
}

/** RFC 5545 text escaping. */
const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** Fold lines at ~74 octets (spec says 75; continuation lines start with a space). */
function fold(line: string): string {
  const out: string[] = [];
  let rest = line;
  while (rest.length > 74) { out.push(rest.slice(0, 74)); rest = ' ' + rest.slice(74); }
  out.push(rest);
  return out.join('\r\n');
}

const DAYCODES = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
const d8 = (iso: string) => iso.replace(/-/g, '');
const hm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}${String(min % 60).padStart(2, '0')}00`;
function plusDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
/** Mon=0 weekday of a yyyy-mm-dd. */
const wd = (iso: string) => (new Date(`${iso}T12:00:00Z`).getUTCDay() + 6) % 7;
const nthOfMonth = (iso: string) => Math.floor((Number(iso.slice(8, 10)) - 1) / 7) + 1;
function isLastOfMonth(iso: string): boolean {
  const d = new Date(`${iso}T12:00:00Z`);
  const dim = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  return d.getUTCDate() + 7 > dim;
}

/** The RRULE-lite spec → an RFC 5545 RRULE, mirroring recurrence.ts exactly. */
function rrule(rec: Rec, anchor: string): string {
  const parts = [`FREQ=${rec.freq.toUpperCase()}`];
  const interval = Math.max(1, rec.interval || 1);
  if (interval > 1) parts.push(`INTERVAL=${interval}`);
  if (rec.freq === 'weekly') {
    const byday = rec.byday?.length ? rec.byday : [wd(anchor)];
    parts.push(`BYDAY=${byday.map((d) => DAYCODES[d]).join(',')}`);
  }
  if (rec.freq === 'monthly' && rec.monthMode === 'weekday') {
    // recurrence.ts: a last-of-month anchor means "the LAST <weekday>".
    const n = isLastOfMonth(anchor) ? -1 : nthOfMonth(anchor);
    parts.push(`BYDAY=${n}${DAYCODES[wd(anchor)]}`);
  }
  const end = rec.end ?? { type: 'never' };
  if (end.type === 'until') parts.push(`UNTIL=${d8(end.date)}T235959Z`);
  if (end.type === 'count') parts.push(`COUNT=${Math.max(1, end.n)}`);
  return parts.join(';');
}

function vevent(e: Ev, tz: string, now: string): string {
  const lines = ['BEGIN:VEVENT', `UID:${e.id}@lichen.health`, `DTSTAMP:${now}`];
  if (e.all_day || e.start_min == null) {
    lines.push(`DTSTART;VALUE=DATE:${d8(e.start_date)}`);
    // DTEND on all-day events is EXCLUSIVE — the day after the last day.
    lines.push(`DTEND;VALUE=DATE:${d8(plusDays(e.end_date ?? e.start_date, 1))}`);
  } else {
    const endMin = e.end_min != null && e.end_min > e.start_min ? e.end_min : e.start_min + 60;
    const endDate = (e.end_date && e.end_date > e.start_date) ? e.end_date : e.start_date;
    lines.push(`DTSTART;TZID=${tz}:${d8(e.start_date)}T${hm(e.start_min)}`);
    lines.push(`DTEND;TZID=${tz}:${d8(endDate)}T${hm(endMin)}`);
  }
  if (e.recurrence) lines.push(`RRULE:${rrule(e.recurrence, e.start_date)}`);
  lines.push(`SUMMARY:${esc(e.title || 'Lichen event')}`);
  if (e.description) lines.push(`DESCRIPTION:${esc(e.description)}`);
  if (e.location) lines.push(`LOCATION:${esc(e.location)}`);
  if (e._tentative) lines.push('STATUS:TENTATIVE');
  lines.push('END:VEVENT');
  return lines.map(fold).join('\r\n');
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
    sb(`events?owner_profile_id=eq.${me}&select=${COLS}&start_date=lte.${hi}&or=(end_date.gte.${lo},start_date.gte.${lo},recurrence.not.is.null)&order=start_date&limit=1000`),
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
