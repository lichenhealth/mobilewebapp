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

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function whenLabel(e: { start_date: string; end_date: string; all_day: boolean; start_min: number | null }): string {
  const [y, m, d] = e.start_date.split('-').map(Number);
  const date = `${MONTHS[m - 1]} ${d}, ${y}`;
  if (e.all_day || e.start_min == null) return date;
  const h = Math.floor(e.start_min / 60), mm = e.start_min % 60;
  const ap = h < 12 ? 'am' : 'pm'; const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${date} · ${h12}${mm ? ':' + String(mm).padStart(2, '0') : ''}${ap}`;
}

const sb = (path: string, init?: RequestInit) =>
  fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SERVICE_KEY!, Authorization: `Bearer ${SERVICE_KEY!}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });

/** The event's door-post cover photo (public URLs by construction) —
 *  what makes the invite pretty; a miss never blocks a send. */
async function coverPhoto(event_id: string): Promise<string | null> {
  return (await eventLook(event_id)).photo;
}
/** The event's cover photo AND the host's Studio design (details.invite). */
async function eventLook(event_id: string): Promise<{ photo: string | null; design: unknown }> {
  try {
    const posts = await (await sb(`posts?linked_event_id=eq.${event_id}&select=details,image_url&limit=1`)).json();
    const po = Array.isArray(posts) ? posts[0] : null;
    if (!po) return { photo: null, design: null };
    const media: { type?: string; url?: string }[] = Array.isArray(po.details?.media) ? po.details.media : [];
    return { photo: media.find((m) => m?.type === 'photo' && m?.url)?.url ?? po.image_url ?? null, design: po.details?.invite ?? null };
  } catch { return { photo: null, design: null }; }
}

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
    event_id?: string; name?: string; email?: string; guest_id?: string;
    test?: { title?: string; start_date?: string; all_day?: boolean; start_min?: number | null; location?: string; photo?: string | null; invite?: unknown };
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
    const to = ((await ures.json().catch(() => null))?.email ?? '').trim();
    if (!to) return json({ error: 'No email on your account to send a test to' }, 400);
    const hosts = await (await sb(`profiles?id=eq.${uid}&select=full_name`)).json();
    const hostName = (Array.isArray(hosts) ? hosts[0]?.full_name : null) || 'A member';
    const when = whenLabel({ start_date: sd, end_date: sd, all_day: !!t.all_day, start_min: startMin });
    const link = `${APP_URL}/events`;
    const text = `[Test — only you received this]\n\n${hostName} invited you to "${title}" on Lichen.\n\nWhen: ${when}${where ? `\nWhere: ${where}` : ''}\n\nYour guests' RSVP button opens their own invitation once you post.\n\n— Lichen`;
    const html = inviteCard({
      title, when, where, hostName, link, photo, design: t.invite ?? null,
      fine: '<strong>This is a test, sent only to you.</strong> Your guests receive this same card — their RSVP button opens their own invitation once you post the event.',
    });
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to: [to], reply_to: REPLY_TO, subject: `[Test] ${hostName} invited you to ${title}`, text, html }),
    });
    if (!res.ok) return json({ error: 'Email failed to send', detail: await res.text() }, 502);
    return json({ ok: true, to });
  }

  // APPROVED MODE (founder 2026-11-04, the open event URL): the host just
  // said yes to a link-born request — mail that EXISTING guest "you're
  // in" with their standing token. Never a second row, never caller words:
  // everything derives from the guest row and its event.
  if (body.guest_id) {
    const gs = await (await sb(`event_guests?id=eq.${body.guest_id}&select=id,event_id,name,email,token,status`)).json();
    const g = Array.isArray(gs) ? gs[0] : null;
    if (!g) return json({ error: 'Guest not found' }, 404);
    const evs = await (await sb(`events?id=eq.${g.event_id}&select=creator_id,title,description,location,start_date,end_date,all_day,start_min,end_min`)).json();
    const ev = Array.isArray(evs) ? evs[0] : null;
    if (!ev) return json({ error: 'Event not found' }, 404);
    if (ev.creator_id !== uid) return json({ error: 'Only the host can approve guests' }, 403);
    if (!g.email?.trim()) return json({ ok: true, skipped: 'no_email' });   // a phone guest gets texted instead
    const hosts = await (await sb(`profiles?id=eq.${uid}&select=full_name`)).json();
    const hostName = (Array.isArray(hosts) ? hosts[0]?.full_name : null) || 'A member';
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
  const evs = await (await sb(`events?id=eq.${event_id}&select=creator_id,title,description,location,start_date,end_date,all_day,start_min,end_min`)).json();
  const ev = Array.isArray(evs) ? evs[0] : null;
  if (!ev) return json({ error: 'Event not found' }, 404);
  if (ev.creator_id !== uid) return json({ error: 'Only the host can invite guests' }, 403);

  // Host name (for the email).
  const hosts = await (await sb(`profiles?id=eq.${uid}&select=full_name`)).json();
  const hostName = (Array.isArray(hosts) ? hosts[0]?.full_name : null) || 'A member';

  // THE PRETTY INVITE (founder 2026-11-04: "pretty invites, like paperless
  // post or canva"): the event's door-post cover photo crowns the emailed
  // card.
  const look = await eventLook(event_id);
  const photo = look.photo;

  // Mint the guest row + token.
  const insRes = await sb('event_guests', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ event_id, invited_by: uid, name: name.trim(), email: email.trim() }),
  });
  const rows = await insRes.json().catch(() => null);
  const guest = Array.isArray(rows) ? rows[0] : null;
  if (!guest?.token) return json({ error: 'Could not create the invite', detail: rows }, 502);

  const link = `${APP_URL}/e/${guest.token}`;
  const when = whenLabel(ev);
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
