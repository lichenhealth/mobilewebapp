// Supabase Edge Function: send-event-invite
//
// Invite someone OUTSIDE Lichen to an event you host. The caller (host, via JWT)
// passes {event_id, name, email}; we verify they created the event, mint a guest
// row with an unguessable token, and email the invite (Resend) with a link to the
// public guest page (/e/<token>). The token authorizes that one event, so it
// works even for private events.
//
// verify_jwt is ON (config.toml) — only signed-in members can send invites.
// Env: RESEND_API_KEY (+ optional NOTIF_FROM, INVITE_REPLY_TO, APP_URL).
// SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are provided automatically.

import { inviteCardHtml } from '../_shared/inviteDesign.ts';
import { whenLabel, restClient, eventLook as sharedLook, hostLine, isHost } from '../_shared/eventMail.ts';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const FROM = Deno.env.get('NOTIF_FROM') ?? 'Lichen <hello@lichen.health>';
const REPLY_TO = Deno.env.get('INVITE_REPLY_TO') ?? 'connect@lichen.health';
const APP_URL = (Deno.env.get('APP_URL') ?? 'https://lichen.healthcare').replace(/\/$/, '');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const sb = restClient(SUPABASE_URL ?? '', SERVICE_KEY ?? '');
const eventLook = (event_id: string) => sharedLook(sb, event_id);

/** ONE invitation-card anatomy for every mail this fn sends (cover photo,
 *  serif title, peach button, per-send stamp — the Gmail-folds-repeated-
 *  tails rule), so the invite and the approved "you're in" can't drift. */
function inviteCard(o: {
  eyebrow?: string; title: string; when: string; where: string;
  hostName: string; link: string; photo: string | null; cta?: string; fine: string; design?: unknown;
}): string {
  return inviteCardHtml(o.design ?? null, {
    title: o.title, when: o.when, where: o.where, hostName: o.hostName, link: o.link, photo: o.photo,
    fine: o.fine, eyebrow: o.eyebrow, cta: o.cta,
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!RESEND_API_KEY || !SUPABASE_URL || !SERVICE_KEY) return json({ error: 'Not configured' }, 500);

  // Caller (host) from the validated JWT.
  let uid: string | null = null;
  try {
    const jwt = (req.headers.get('Authorization') ?? '').split(' ')[1];
    uid = JSON.parse(atob(jwt.split('.')[1])).sub;
  } catch { /* fall through */ }
  if (!uid) return json({ error: 'Unauthorized' }, 401);

  let body: {
    event_id?: string; name?: string; email?: string; guest_id?: string; send_at?: string; announce?: string;
    test?: { to?: string; title?: string; start_date?: string; all_day?: boolean; start_min?: number | null; location?: string; photo?: string | null; invite?: unknown };
  };
  try { body = await req.json(); } catch { return json({ error: 'Invalid body' }, 400); }

  // TEST MODE (founder 2026-11-05, "like paperless post"): the host previews
  // the real card in their own inbox BEFORE the event exists. The recipient
  // is the CALLER'S OWN account email, read server-side — never caller input
  // — so a test can only ever reach yourself. No guest row, no token.
  if (body.test) {
    const t = body.test;
    const title = String(t.title ?? '').trim().slice(0, 200) || 'Your event';
    const sd = String(t.start_date ?? '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(sd)) return json({ error: 'Pick a date first' }, 400);
    const startMin = typeof t.start_min === 'number' && t.start_min >= 0 && t.start_min < 1440 ? Math.round(t.start_min) : null;
    const where = String(t.location ?? '').trim().slice(0, 200);
    const photoIn = String(t.photo ?? '');
    const photo = photoIn.startsWith(`${SUPABASE_URL}/storage/v1/object/public/`) ? photoIn : null;
    const ures = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${uid}`, {
      headers: { apikey: SERVICE_KEY!, Authorization: `Bearer ${SERVICE_KEY!}` },
    });
    const own = ((await ures.json().catch(() => null))?.email ?? '').trim();
    // The test defaults to the host's own inbox; they may type another address
    // (founder 2026-11-09: "auto setup for your email… but you can edit or send
    // to a different address as well"). One address, a plain [Test] card.
    const asked = String(t.to ?? '').trim().toLowerCase();
    if (asked && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(asked)) return json({ error: 'That email doesn’t look complete' }, 400);
    const to = asked || own;
    const toSelf = !asked || asked === own.toLowerCase();
    if (!to) return json({ error: 'No email on your account to send a test to' }, 400);
    const hosts = await (await sb(`profiles?id=eq.${uid}&select=full_name`)).json();
    const hostName = (Array.isArray(hosts) ? hosts[0]?.full_name : null) || 'A member';
    const when = whenLabel({ start_date: sd, end_date: sd, all_day: !!t.all_day, start_min: startMin });
    const link = `${APP_URL}/events`;
    const text = `[Test${toSelf ? ' — only you received this' : ` — sent by ${hostName} as a preview`}]\n\n${hostName} invited you to "${title}" on Lichen.\n\nWhen: ${when}${where ? `\nWhere: ${where}` : ''}\n\nYour guests' RSVP button opens their own invitation once you post.\n\n— Lichen`;
    const html = inviteCard({
      title, when, where, hostName, link, photo, design: t.invite ?? null,
      fine: toSelf
        ? '<strong>This is a test, sent only to you.</strong> Your guests receive this same card — their RSVP button opens their own invitation once you post the event.'
        : `<strong>This is a test preview from ${hostName.replace(/[<>&]/g, '')}.</strong> It isn't your invitation yet — the real one arrives once the event is posted.`,
    });
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to: [to], reply_to: REPLY_TO, subject: `[Test] ${hostName} invited you to ${title}`, text, html }),
    });
    if (!res.ok) return json({ error: 'Email failed to send', detail: await res.text() }, 502);
    return json({ ok: true, to });
  }

  // HOST MESSAGE (founder 2026-11-08, the Paperless Post audit — "message
  // all your guests"): the message row is written client-side under RLS
  // (hosts only); this mails it to every emailed guest still coming or
  // undecided. Member attendees were already belled by the row's trigger;
  // phone guests read it on their own invitation page.
  if (body.announce) {
    const ms = await (await sb(`event_messages?id=eq.${body.announce}&select=id,event_id,author_id,body,emailed`)).json();
    const m = Array.isArray(ms) ? ms[0] : null;
    if (!m) return json({ error: 'Message not found' }, 404);
    if (m.author_id !== uid) return json({ error: 'Only the author can send this message' }, 403);
    if (m.emailed > 0) return json({ ok: true, sent: m.emailed });
    const evs = await (await sb(`events?id=eq.${m.event_id}&select=id,creator_id,title,location,start_date,end_date,all_day,start_min,timezone`)).json();
    const ev = Array.isArray(evs) ? evs[0] : null;
    if (!ev || !(await isHost(sb, ev.id, ev.creator_id, uid))) return json({ error: 'Only the hosts can message guests' }, 403);
    const gs = await (await sb(`event_guests?event_id=eq.${ev.id}&status=in.(invited,going,tentative)&email=not.is.null&select=email,token,send_at,emailed_at`)).json();
    const authors = await (await sb(`profiles?id=eq.${uid}&select=full_name`)).json();
    const from = (Array.isArray(authors) ? authors[0]?.full_name : null) || 'The host';
    const look = await eventLook(ev.id);
    const when = whenLabel(ev);
    const where = (ev.location || '').trim();
    const msgHtml = esc(String(m.body)).replace(/\n/g, '<br>');
    let sent = 0;
    for (const g of (Array.isArray(gs) ? gs : [])) {
      if (g.send_at && !g.emailed_at) continue;   // a scheduled invite hasn't gone yet — the message would arrive first
      const link = `${APP_URL}/e/${g.token}`;
      const html = inviteCardHtml(look.design, {
        title: ev.title, when, where, hostName: from, link, photo: look.photo,
        eyebrow: `A note from ${from}`, cta: 'See your invitation',
        fine: `<span style="display:block;font-size:15px;line-height:1.55;color:inherit;margin-bottom:10px;">${msgHtml}</span>Reply to this email to reach Lichen; your RSVP lives on your invitation.`,
      });
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: FROM, to: [String(g.email).trim()], reply_to: REPLY_TO,
          subject: `${from}: an update on ${ev.title}`,
          text: `${from} sent an update about "${ev.title}":\n\n${m.body}\n\nYour invitation: ${link}\n\n— Lichen`, html,
        }),
      });
      if (res.ok) sent++;
    }
    await sb(`event_messages?id=eq.${m.id}`, { method: 'PATCH', body: JSON.stringify({ emailed: Math.max(sent, 1) }) });
    return json({ ok: true, sent });
  }

  // APPROVED MODE (founder 2026-11-04, the open event URL): the host just
  // said yes to a link-born request — mail that EXISTING guest "you're
  // in" with their standing token. Never a second row, never caller words:
  // everything derives from the guest row and its event.
  if (body.guest_id) {
    const gs = await (await sb(`event_guests?id=eq.${body.guest_id}&select=id,event_id,name,email,token,status`)).json();
    const g = Array.isArray(gs) ? gs[0] : null;
    if (!g) return json({ error: 'Guest not found' }, 404);
    const evs = await (await sb(`events?id=eq.${g.event_id}&select=creator_id,title,description,location,start_date,end_date,all_day,start_min,end_min,timezone`)).json();
    const ev = Array.isArray(evs) ? evs[0] : null;
    if (!ev) return json({ error: 'Event not found' }, 404);
    if (!(await isHost(sb, g.event_id, ev.creator_id, uid))) return json({ error: 'Only the hosts can approve guests' }, 403);
    if (!g.email?.trim()) return json({ ok: true, skipped: 'no_email' });   // a phone guest gets texted instead
    const hostName = await hostLine(sb, g.event_id, ev.creator_id);
    const link = `${APP_URL}/e/${g.token}`;
    const when = whenLabel(ev);
    const where = (ev.location || '').trim();
    const text = `Good news — ${hostName} said yes: you're in for "${ev.title}".\n\nWhen: ${when}${where ? `\nWhere: ${where}` : ''}\n\nRSVP and add it to your calendar:\n${link}\n\n— Lichen`;
    const look = await eventLook(g.event_id);
    const html = inviteCard({
      eyebrow: 'You’re in', title: ev.title, when, where, hostName,
      link, photo: look.photo, design: look.design, cta: 'RSVP & see the details',
      fine: `${esc(hostName)} approved your request to come. RSVP as a guest and add it to your own calendar in one tap — no account needed.`,
    });
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to: [g.email.trim()], reply_to: REPLY_TO, subject: `You're in — ${ev.title}`, text, html }),
    });
    if (!res.ok) return json({ error: 'Email failed to send', detail: await res.text() }, 502);
    return json({ ok: true });
  }

  const { event_id, name, email } = body;
  if (!event_id || !name?.trim() || !email?.trim()) return json({ error: 'Missing name, email, or event' }, 400);

  // Verify the caller created (hosts) this event.
  const evs = await (await sb(`events?id=eq.${event_id}&select=creator_id,title,description,location,start_date,end_date,all_day,start_min,end_min,timezone,poll_status`)).json();
  const ev = Array.isArray(evs) ? evs[0] : null;
  if (!ev) return json({ error: 'Event not found' }, 404);
  if (!(await isHost(sb, event_id, ev.creator_id, uid))) return json({ error: 'Only the hosts can invite guests' }, 403);

  // SCHEDULED SEND (founder 2026-11-08, the Paperless Post audit): a future
  // send_at mints the row now and leaves the mail to tick_event_mail.
  const sendAt = body.send_at && !isNaN(Date.parse(body.send_at)) ? new Date(body.send_at) : null;
  if (sendAt && sendAt.getTime() > Date.now() + 60_000) {
    if (sendAt.getTime() > Date.now() + 1000 * 60 * 60 * 24 * 366) return json({ error: 'Pick a send time within the year' }, 400);
    const r = await sb('event_guests', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ event_id, invited_by: uid, name: name.trim(), email: email.trim(), send_at: sendAt.toISOString() }),
    });
    const rr = await r.json().catch(() => null);
    const row = Array.isArray(rr) ? rr[0] : null;
    if (!row?.token) return json({ error: 'Could not schedule the invite', detail: rr }, 502);
    return json({ ok: true, token: row.token, scheduled: row.send_at });
  }

  const hostName = await hostLine(sb, event_id, ev.creator_id);

  // THE PRETTY INVITE (founder 2026-11-04: "pretty invites, like paperless
  // post or canva"): the event's door-post cover photo crowns the emailed
  // card.
  const look = await eventLook(event_id);
  const photo = look.photo;

  // Mint the guest row + token.
  const insRes = await sb('event_guests', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ event_id, invited_by: uid, name: name.trim(), email: email.trim(), emailed_at: new Date().toISOString() }),
  });
  const rows = await insRes.json().catch(() => null);
  const guest = Array.isArray(rows) ? rows[0] : null;
  if (!guest?.token) return json({ error: 'Could not create the invite', detail: rows }, 502);

  const link = `${APP_URL}/e/${guest.token}`;
  const when = ev.poll_status === 'open' ? 'Help choose the time — pick every time that works' : whenLabel(ev);
  const where = (ev.location || '').trim();
  const subject = `${hostName} invited you to ${ev.title}`;
  const text = `${hostName} invited you to "${ev.title}" on Lichen.\n\nWhen: ${when}${where ? `\nWhere: ${where}` : ''}\n\nSee the details, add it to your calendar, or RSVP — no account needed:\n${link}\n\n— Lichen`;
  const html = inviteCard({
    title: ev.title, when, where, hostName,
    link, photo, design: look.design,
    fine: 'No account needed — RSVP as a guest and add it to your own calendar in one tap. Lichen is a community for healing, growing and creating; you can request to join from the invitation.',
  });

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: [email.trim()], reply_to: REPLY_TO, subject, text, html }),
  });
  if (!res.ok) return json({ error: 'Email failed to send', detail: await res.text() }, 502);
  return json({ ok: true, token: guest.token });
});
