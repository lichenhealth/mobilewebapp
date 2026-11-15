// SHARE MY LICHEN CALENDAR BY EMAIL (founder 2026-11-15). The caller sends
// ONE of their own calendar_feed_shares rows by id; the recipient address and
// the link are read off that row (never caller words), the mail comes
// "«Name» via Lichen" with the owner's own address as Reply-To. The optional
// note is the owner's own words, typed in the card.
// verify_jwt = true. Env: RESEND_API_KEY.
import { shareMessage, FEED_BASE } from '../_shared/calShare.ts';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const FROM_ADDR = 'hello@lichen.health';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });
const h = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const svc = (path: string, init?: RequestInit) =>
  fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...init, headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!RESEND_API_KEY || !SUPABASE_URL || !SERVICE_KEY) return json({ error: 'Not configured' }, 500);
  const ures = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: ANON_KEY || SERVICE_KEY, Authorization: req.headers.get('Authorization') ?? '' } });
  const user = ures.ok ? await ures.json().catch(() => null) : null;
  if (!user?.id) return json({ error: 'Sign in first' }, 401);

  const body = await req.json().catch(() => ({}));
  const id = String(body.share_id ?? '');
  if (!/^[0-9a-f-]{36}$/.test(id)) return json({ error: 'Which share?' }, 400);
  const r = await svc(`calendar_feed_shares?id=eq.${id}&owner_id=eq.${user.id}&revoked_at=is.null&select=token,recipient_name,recipient_email,detail`);
  const share = ((await r.json().catch(() => [])) as { token: string; recipient_name: string; recipient_email: string | null; detail: string }[])[0];
  if (!share) return json({ error: 'That share isn\'t yours, or it was stopped.' }, 404);
  if (!share.recipient_email) return json({ error: 'There\'s no email address on this share.' }, 400);

  const pr = await svc(`profiles?id=eq.${user.id}&select=full_name,first_name`);
  const prof = ((await pr.json().catch(() => [])) as { full_name: string | null; first_name: string | null }[])[0];
  const name = prof?.full_name || 'A Lichen member';
  const first = prof?.first_name || name.split(' ')[0];
  const note = String(body.note ?? '').trim().slice(0, 1500);
  const text = (note ? note + '\n\n' : '') + shareMessage(first, share.detail, FEED_BASE + share.token);
  const htmlBody = text.split('\n').map((l) => l.startsWith('https://') ? `<a href="${h(l)}" style="color:#B5562F;word-break:break-all">${h(l)}</a>` : h(l)).join('<br>');
  const stamp = new Date().toUTCString();

  const send = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: `${name} via Lichen <${FROM_ADDR}>`,
      to: [share.recipient_email],
      reply_to: user.email ?? undefined,
      subject: `${first} shared their calendar with you`,
      text: text + `\n\nSent ${stamp}`,
      html: `<div style="font-family:Georgia,serif;font-size:16px;line-height:1.55;color:#1d2326;max-width:560px">${htmlBody}<p style="color:#8a8f92;font-size:12px;margin-top:24px">Sent through Lichen · ${h(stamp)}</p></div>`,
    }),
  });
  if (!send.ok) return json({ error: 'The email didn\'t go out — try again in a moment.' }, 502);
  await svc(`calendar_feed_shares?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify({ channel: 'email', sent_at: new Date().toISOString() }) });
  return json({ ok: true });
});
