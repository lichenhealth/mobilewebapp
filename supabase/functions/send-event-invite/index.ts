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

  // THE PRETTY INVITE (founder 2026-11-04: "pretty invites, like paperless
  // post or canva"): the event's door-post cover photo crowns the emailed
  // card — post media URLs are public by construction, so the mail client
  // can load it straight.
  let photo: string | null = null;
  try {
    const posts = await (await sb(`posts?linked_event_id=eq.${event_id}&select=details,image_url&limit=1`)).json();
    const po = Array.isArray(posts) ? posts[0] : null;
    if (po) {
      const media: { type?: string; url?: string }[] = Array.isArray(po.details?.media) ? po.details.media : [];
      photo = media.find((m) => m?.type === 'photo' && m?.url)?.url ?? po.image_url ?? null;
    }
  } catch { /* a missing photo never blocks the invite */ }

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
  // The invitation CARD (founder 2026-11-04, "pretty invites, like
  // paperless post or canva"): cover photo on top, serif title, centered —
  // the /e/ landing page wears the same anatomy, so the click keeps the
  // promise. The per-send stamp keeps Gmail from folding a re-invite's
  // tail as repeated content (the send-booking-mail lesson).
  const stamp = new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/Denver' });
  const html = `<!doctype html><html><body style="margin:0;background:#f3efe9;font-family:Archivo,Helvetica,Arial,sans-serif;color:#2b2b28">
  <div style="max-width:520px;margin:0 auto;padding:32px 24px">
    <p style="font-size:22px;font-weight:600;margin:0 0 14px">Lichen</p>
    <div style="background:#fff;border:1px solid #e6e1d8;border-radius:18px;overflow:hidden;margin:0 0 22px;box-shadow:0 10px 30px rgba(42,51,56,0.08)">
      ${photo ? `<img src="${esc(photo)}" alt="" width="520" style="display:block;width:100%;max-height:300px;object-fit:cover">` : ''}
      <div style="padding:26px 24px 22px;text-align:center">
        <p style="font-family:'Iowan Old Style',Georgia,'Times New Roman',serif;font-size:12px;letter-spacing:0.12em;text-transform:uppercase;color:#c06b3e;margin:0 0 10px">You're invited</p>
        <p style="font-family:'Iowan Old Style',Georgia,'Times New Roman',serif;font-size:28px;font-weight:400;line-height:1.2;margin:0 0 14px">${esc(ev.title)}</p>
        <p style="font-size:15px;color:#2b2b28;margin:0 0 4px">${esc(when)}</p>
        ${where ? `<p style="font-size:14px;color:#5a554c;margin:0 0 4px">${esc(where)}</p>` : ''}
        <p style="font-size:14px;color:#5a554c;margin:12px 0 18px">Hosted by <strong>${esc(hostName)}</strong></p>
        <a href="${link}" style="display:inline-block;background:#e8956b;color:#fff;text-decoration:none;padding:12px 24px;border-radius:999px;font-weight:600">RSVP &amp; see the details</a>
      </div>
    </div>
    <p style="font-size:13px;color:#8a857c;line-height:1.5;margin:0 0 6px">No account needed — RSVP as a guest and add it to your own calendar in one tap. Lichen is a community for healing, growing and creating; you can request to join from the invitation.</p>
    <p style="font-size:11px;color:#b5b0a6;margin:10px 0 0">Sent ${esc(stamp)} MT</p>
  </div></body></html>`;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: [email.trim()], reply_to: REPLY_TO, subject, text, html }),
  });
  if (!res.ok) return json({ error: 'Email failed to send', detail: await res.text() }, 502);
  return json({ ok: true, token: guest.token });
});
