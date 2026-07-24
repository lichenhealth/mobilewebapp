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

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const FROM = Deno.env.get('NOTIF_FROM') ?? 'Lichen <hello@lichen.healthcare>';
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

  let body: { event_id?: string; name?: string; email?: string };
  try { body = await req.json(); } catch { return json({ error: 'Invalid body' }, 400); }
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
  const html = `<!doctype html><html><body style="margin:0;background:#f3efe9;font-family:Archivo,Helvetica,Arial,sans-serif;color:#2b2b28">
  <div style="max-width:520px;margin:0 auto;padding:32px 24px">
    <p style="font-size:22px;font-weight:600;margin:0 0 6px">Lichen</p>
    <p style="font-size:16px;line-height:1.5;margin:0 0 18px"><strong>${esc(hostName)}</strong> invited you to an event.</p>
    <div style="background:#fff;border:1px solid #e6e1d8;border-radius:14px;padding:18px 20px;margin:0 0 22px">
      <p style="font-size:18px;font-weight:600;margin:0 0 8px">${esc(ev.title)}</p>
      <p style="font-size:14px;color:#5a554c;margin:0 0 4px">${esc(when)}</p>
      ${where ? `<p style="font-size:14px;color:#5a554c;margin:0">${esc(where)}</p>` : ''}
    </div>
    <p style="margin:0 0 24px">
      <a href="${link}" style="display:inline-block;background:#e8956b;color:#fff;text-decoration:none;padding:12px 22px;border-radius:999px;font-weight:600">See the event &amp; RSVP</a>
    </p>
    <p style="font-size:13px;color:#8a857c;line-height:1.5;margin:0">No account needed — add it to your calendar or RSVP as a guest. You can make a Lichen account if you'd like.</p>
  </div></body></html>`;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: [email.trim()], reply_to: REPLY_TO, subject, text, html }),
  });
  if (!res.ok) return json({ error: 'Email failed to send', detail: await res.text() }, 502);
  return json({ ok: true, token: guest.token });
});
