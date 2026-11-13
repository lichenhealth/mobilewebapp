// Supabase Edge Function: send-calendar-invite
//
// SEND TO THEIR CALENDAR (founder 2026-11-13: "I want to invite outside synced
// calendars to Events - in this case, my google cal, so gabe can see the vet
// visit for our dog… the on platform/off platform ease that we're trying to
// build is everywhere" → "yes, build the send-to-their-calendar invite").
//
// Emails each invitee a REAL calendar invitation — an iTIP .ics with
// METHOD:REQUEST attached as text/calendar — which Google, Apple and Outlook
// show as an event with Yes / No / Maybe. Three modes:
//   send   — to the members named (each MUST already be invited to the event —
//            never an arbitrary member) and to typed email addresses;
//   update — the event changed: SEQUENCE+1, re-sent to everyone who got one;
//   cancel — the event is going away: METHOD:CANCEL to everyone who got one,
//            so it comes off their calendars too (call BEFORE deleting).
//
// PRIVACY: a member's email is read server-side (Admin users API) and never
// returned; each mail lists ONLY its own recipient as ATTENDEE, so nobody sees
// anyone else's address. The ORGANIZER is the host (name + their own email) —
// replies land in the host's inbox, said plainly in the composer.
//
// Authorization: caller JWT → must be a host of the event (is_event_host).
// verify_jwt = true. Env: RESEND_API_KEY.

import { esc as icsEsc, fold, vevent, type Ev } from '../_shared/ics.ts';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const FROM_ADDR = 'hello@lichen.health';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const MAX = 30;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });
const h = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const EMAIL_RE = /^[^\s@<>,;]+@[^\s@<>,;]+\.[A-Za-z]{2,}$/;

const svc = (path: string, init?: RequestInit) =>
  fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
const rows = async (path: string) => { const r = await svc(path); return r.ok ? (await r.json().catch(() => [])) : []; };

async function authEmail(uid: string): Promise<string | null> {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${uid}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  if (!r.ok) return null;
  const u = await r.json().catch(() => null);
  return (u?.email as string | undefined)?.toLowerCase() ?? null;
}

function b64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

const fmtMin = (m: number) => {
  const hh = Math.floor(m / 60), mm = m % 60;
  const ap = hh < 12 ? 'am' : 'pm';
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return mm ? `${h12}:${String(mm).padStart(2, '0')}${ap}` : `${h12}${ap}`;
};
function whenLine(e: Ev & { timezone?: string | null }, tz: string): string {
  const d = new Date(`${e.start_date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
  const end = e.end_date && e.end_date > e.start_date
    ? ' – ' + new Date(`${e.end_date}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' }) : '';
  if (e.all_day || e.start_min == null) return `${d}${end} · all day`;
  let zone = '';
  try {
    zone = ' ' + (new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' })
      .formatToParts(new Date(`${e.start_date}T18:00:00Z`)).find((p) => p.type === 'timeZoneName')?.value ?? '');
  } catch { /* unknown zone — say nothing */ }
  const em = e.end_min != null && e.end_min > e.start_min ? ` – ${fmtMin(e.end_min)}` : '';
  return `${d}${end} · ${fmtMin(e.start_min)}${em}${zone}`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!RESEND_API_KEY || !SUPABASE_URL || !SERVICE_KEY) return json({ error: 'Not configured' }, 500);

  const auth = req.headers.get('Authorization') ?? '';
  const ures = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: ANON_KEY || SERVICE_KEY, Authorization: auth } });
  const user = ures.ok ? await ures.json().catch(() => null) : null;
  if (!user?.id) return json({ error: 'Sign in first' }, 401);

  const body = await req.json().catch(() => ({}));
  const eventId = String(body.event_id ?? '');
  const mode = (['send', 'update', 'cancel'].includes(body.mode) ? body.mode : 'send') as 'send' | 'update' | 'cancel';
  if (!/^[0-9a-f-]{36}$/.test(eventId)) return json({ error: 'Which event?' }, 400);

  const hostR = await svc('rpc/is_event_host', { method: 'POST', body: JSON.stringify({ p_event: eventId, p_uid: user.id }) });
  if (!hostR.ok || (await hostR.json().catch(() => false)) !== true) return json({ error: 'Only the event’s host can send its invitations.' }, 403);

  const evs = await rows(`events?id=eq.${eventId}&select=id,title,description,location,start_date,end_date,all_day,start_min,end_min,recurrence,timezone,ical_sequence,creator_id`);
  const ev = evs[0] as (Ev & { timezone: string | null; ical_sequence: number; creator_id: string }) | undefined;
  if (!ev) return json({ error: 'That event is gone.' }, 404);

  const prof = (await rows(`profiles?id=eq.${user.id}&select=full_name,timezone`))[0] as { full_name: string | null; timezone: string | null } | undefined;
  const hostName = prof?.full_name?.trim() || 'A Lichen member';
  const tz = ev.timezone || prof?.timezone || 'America/Denver';
  const hostEmail = (user.email as string | undefined)?.toLowerCase() || FROM_ADDR;

  // A unique Zoom room rides the invitation (invitees would get it on Lichen too).
  const meet = (await rows(`event_meetings?event_id=eq.${eventId}&select=join_url`))[0] as { join_url: string | null } | undefined;

  // ── who gets this mail ──
  type Rcpt = { email: string; profile_id: string | null; name: string };
  let targets: Rcpt[] = [];
  let seq = ev.ical_sequence ?? 0;

  if (mode === 'send') {
    const memberIds: string[] = Array.isArray(body.members) ? body.members.filter((x: unknown) => typeof x === 'string' && /^[0-9a-f-]{36}$/.test(x as string)) : [];
    const emails: string[] = Array.isArray(body.emails)
      ? [...new Set(body.emails.map((x: unknown) => String(x ?? '').trim().toLowerCase()).filter((x: string) => EMAIL_RE.test(x)))] as string[]
      : [];
    if (memberIds.length + emails.length === 0) return json({ sent: 0 });
    if (memberIds.length + emails.length > MAX) return json({ error: `That’s more than ${MAX} people at once — send in smaller groups.` }, 400);
    if (memberIds.length) {
      // Only people already invited to THIS event — never an arbitrary member.
      const att = await rows(`event_attendees?event_id=eq.${eventId}&profile_id=in.(${memberIds.join(',')})&select=profile_id,profile:profiles!event_attendees_profile_id_fkey(full_name)`)
        .catch(() => []);
      const okIds = new Map<string, string>((att as { profile_id: string; profile: { full_name: string | null } | null }[])
        .map((a) => [a.profile_id, a.profile?.full_name ?? 'there']));
      for (const id of memberIds) {
        if (!okIds.has(id) || id === user.id) continue;
        const em = await authEmail(id);
        if (em) targets.push({ email: em, profile_id: id, name: okIds.get(id)! });
      }
    }
    for (const em of emails) if (em !== hostEmail) targets.push({ email: em, profile_id: null, name: '' });
  } else {
    const sent = await rows(`event_calendar_sends?event_id=eq.${eventId}&select=email,profile_id`) as { email: string; profile_id: string | null }[];
    if (!sent.length) return json({ sent: 0 });
    targets = sent.map((s) => ({ email: s.email, profile_id: s.profile_id, name: '' }));
    seq += 1;
    await svc(`events?id=eq.${eventId}`, { method: 'PATCH', body: JSON.stringify({ ical_sequence: seq }) });
  }
  // de-dupe by address
  targets = [...new Map(targets.map((t) => [t.email, t])).values()];

  const method = mode === 'cancel' ? 'CANCEL' : 'REQUEST';
  const now = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const desc = [ev.description?.trim(), meet?.join_url ? `Join: ${meet.join_url}` : '', `Sent from Lichen by ${hostName}.`].filter(Boolean).join('\n\n');
  const evForIcs: Ev = { ...ev, description: desc, location: ev.location || (meet?.join_url ? 'Zoom' : null) };
  const when = whenLine(ev, tz);
  const title = ev.title || 'An event';

  let sentCount = 0;
  const failed: string[] = [];
  for (const t of targets) {
    const extra = [
      `SEQUENCE:${seq}`,
      fold(`ORGANIZER;CN=${icsEsc(hostName)}:mailto:${hostEmail}`),
      fold(`ATTENDEE;${t.name ? `CN=${icsEsc(t.name)};` : ''}ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${t.email}`),
      ...(mode === 'cancel' ? ['STATUS:CANCELLED'] : []),
    ];
    const ics = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Lichen//Calendar Invite//EN', 'CALSCALE:GREGORIAN', `METHOD:${method}`,
      vevent(evForIcs, tz, now, extra, { utc: true }),
      'END:VCALENDAR', '',
    ].join('\r\n');

    const first = t.name.split(/\s+/)[0];
    const hello = first ? `Hi ${h(first)},` : 'Hi,';
    const lead = mode === 'cancel'
      ? `${h(hostName)} cancelled <strong>${h(title)}</strong>. It will come off your calendar.`
      : mode === 'update'
        ? `${h(hostName)} updated <strong>${h(title)}</strong>. Your calendar will show the new details.`
        : `${h(hostName)} invited you to <strong>${h(title)}</strong>.`;
    const subject = mode === 'cancel' ? `Cancelled: ${title}` : mode === 'update' ? `Updated: ${title}` : `Invitation: ${title}`;
    const html = `<div style="font-family:Georgia,serif;max-width:520px;margin:0 auto;padding:24px;color:#1F2629;">
<p style="font-size:16px;line-height:1.5;">${hello}</p>
<p style="font-size:16px;line-height:1.5;">${lead}</p>
<div style="border:1px solid #E5DED2;border-radius:12px;padding:16px 18px;margin:16px 0;background:#FBF8F3;">
<div style="font-size:20px;margin-bottom:6px;${mode === 'cancel' ? 'text-decoration:line-through;' : ''}">${h(title)}</div>
<div style="font-family:Arial,sans-serif;font-size:14px;color:#4A5357;">${h(when)}</div>
${ev.location ? `<div style="font-family:Arial,sans-serif;font-size:14px;color:#4A5357;margin-top:4px;">${h(ev.location)}</div>` : ''}
${ev.description && mode !== 'cancel' ? `<div style="font-family:Arial,sans-serif;font-size:14px;color:#4A5357;margin-top:10px;white-space:pre-wrap;">${h(ev.description)}</div>` : ''}
</div>
${mode === 'cancel' ? '' : `<p style="font-family:Arial,sans-serif;font-size:13px;color:#6B7378;line-height:1.5;">Your calendar app shows Yes / No / Maybe on this email — your answer goes straight to ${h(hostName)}.</p>`}
<p style="font-family:Arial,sans-serif;font-size:11px;color:#9AA0A3;margin-top:24px;">Sent with Lichen on behalf of ${h(hostName)} · ${new Date().toUTCString()}</p>
</div>`;
    const text = `${first ? `Hi ${first},` : 'Hi,'}\n\n${lead.replace(/<[^>]+>/g, '')}\n\n${title}\n${when}${ev.location ? `\n${ev.location}` : ''}\n\nSent with Lichen on behalf of ${hostName}.`;

    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: `${hostName} via Lichen <${FROM_ADDR}>`,
        to: [t.email],
        reply_to: hostEmail,
        subject, html, text,
        attachments: [{ filename: mode === 'cancel' ? 'cancel.ics' : 'invite.ics', content: b64(ics), content_type: `text/calendar; method=${method}; charset=UTF-8` }],
      }),
    });
    if (r.ok) {
      sentCount++;
      if (mode === 'send') {
        await svc('event_calendar_sends?on_conflict=event_id,email', {
          method: 'POST',
          headers: { Prefer: 'resolution=merge-duplicates' },
          body: JSON.stringify({ event_id: eventId, email: t.email, profile_id: t.profile_id, sent_at: new Date().toISOString() }),
        });
      }
    } else {
      failed.push(t.profile_id ? 'a member' : t.email);
      console.error('resend', r.status, await r.text().catch(() => ''));
    }
  }

  return json({ sent: sentCount, failed });
});
