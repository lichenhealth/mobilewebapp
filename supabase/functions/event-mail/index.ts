// Supabase Edge Function: event-mail
//
// The CRON side of event invitations (tick_event_mail, every 5 minutes):
//   kind 'invite'   — a SCHEDULED invitation whose send time has come
//   kind 'reminder' — the automatic day-before reminder to a guest who said
//                     going or maybe
// Everything is derived from the guest row and its event — the body names
// only {kind, guest_id}. verify_jwt is OFF; gated by x-webhook-secret ==
// PUSH_HOOK_SECRET (the fire-reminders pattern).

import { inviteCardHtml } from '../_shared/inviteDesign.ts';
import { whenLabel, restClient, eventLook, hostLine } from '../_shared/eventMail.ts';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const FROM = Deno.env.get('NOTIF_FROM') ?? 'Lichen <hello@lichen.health>';
const REPLY_TO = Deno.env.get('INVITE_REPLY_TO') ?? 'connect@lichen.health';
const APP_URL = (Deno.env.get('APP_URL') ?? 'https://lichen.healthcare').replace(/\/$/, '');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const WEBHOOK_SECRET = Deno.env.get('PUSH_HOOK_SECRET');

const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });
const sb = restClient(SUPABASE_URL, SERVICE_KEY);

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!WEBHOOK_SECRET || req.headers.get('x-webhook-secret') !== WEBHOOK_SECRET) return json({ error: 'Unauthorized' }, 401);
  if (!RESEND_API_KEY) return json({ error: 'Not configured' }, 500);
  let body: { kind?: string; guest_id?: string };
  try { body = await req.json(); } catch { return json({ error: 'Invalid body' }, 400); }
  const { kind, guest_id } = body;
  if (!guest_id || (kind !== 'invite' && kind !== 'reminder')) return json({ error: 'Bad request' }, 400);

  const gs = await (await sb(`event_guests?id=eq.${guest_id}&select=id,event_id,name,email,token,status`)).json();
  const g = Array.isArray(gs) ? gs[0] : null;
  if (!g?.email?.trim()) return json({ ok: true, skipped: 'no_email' });
  if (kind === 'reminder' && !['going', 'tentative'].includes(g.status)) return json({ ok: true, skipped: 'status' });
  if (kind === 'invite' && !['invited', 'going', 'tentative'].includes(g.status)) return json({ ok: true, skipped: 'status' });

  const evs = await (await sb(`events?id=eq.${g.event_id}&select=id,creator_id,title,location,start_date,end_date,all_day,start_min,timezone`)).json();
  const ev = Array.isArray(evs) ? evs[0] : null;
  if (!ev) return json({ ok: true, skipped: 'no_event' });

  const hostName = await hostLine(sb, ev.id, ev.creator_id);
  const look = await eventLook(sb, ev.id);
  const link = `${APP_URL}/e/${g.token}`;
  const when = whenLabel(ev);
  const where = (ev.location || '').trim();

  let subject: string, text: string, html: string;
  if (kind === 'invite') {
    subject = `${hostName} invited you to ${ev.title}`;
    text = `${hostName} invited you to "${ev.title}" on Lichen.\n\nWhen: ${when}${where ? `\nWhere: ${where}` : ''}\n\nSee the details, add it to your calendar, or RSVP — no account needed:\n${link}\n\n— Lichen`;
    html = inviteCardHtml(look.design, {
      title: ev.title, when, where, hostName, link, photo: look.photo,
      fine: `No account needed — RSVP as a guest and add it to your own calendar in one tap.`,
    });
  } else {
    // The event's own Zoom room rides the reminder for guests who are in.
    const zm = await (await sb(`event_meetings?event_id=eq.${ev.id}&select=join_url`)).json().catch(() => null);
    const zoom: string | null = Array.isArray(zm) && zm[0]?.join_url ? zm[0].join_url : null;
    subject = `Coming up: ${ev.title}`;
    text = `A reminder from ${hostName}: "${ev.title}" is coming up.\n\nWhen: ${when}${where ? `\nWhere: ${where}` : ''}${zoom ? `\nJoin Zoom: ${zoom}` : ''}\n\nYour invitation, RSVP and calendar links:\n${link}\n\n— Lichen`;
    html = inviteCardHtml(look.design, {
      title: ev.title, when, where, hostName, link, photo: look.photo,
      eyebrow: 'A reminder', cta: 'See your invitation',
      fine: `${zoom ? `<a href="${zoom}" style="color:#5E89AD;font-weight:600">Join Zoom</a> — this room is just for the event's guests.<br><br>` : ''}You said you'd ${g.status === 'going' ? 'be there' : 'maybe come'} — change your RSVP any time from your invitation.`,
    });
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: [g.email.trim()], reply_to: REPLY_TO, subject, text, html }),
  });
  if (!res.ok) {
    // An invite that didn't go is released so the next tick tries again.
    if (kind === 'invite') await sb(`event_guests?id=eq.${g.id}`, { method: 'PATCH', body: JSON.stringify({ emailed_at: null }) });
    return json({ error: 'Email failed', detail: await res.text() }, 502);
  }
  return json({ ok: true });
});
