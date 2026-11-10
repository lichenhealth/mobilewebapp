// Supabase Edge Function: knock-reply
//
// REPLY WITHOUT LETTING THEM IN (founder 2026-11-10: a stranger knocked after
// a Facebook post, interested in therapy — "reply to them with a custom
// message and some time to chat with me via my booking link, but not accept
// them into lichen"). The steward writes a message (the client offers their
// booking link as a one-tap insert); this emails the knocker, with the
// steward's OWN address as Reply-To so the conversation continues in their
// inbox. The knock stays at the door — no invitation, no token, no seat.
//
// Authorization: the caller's JWT reads the knock THROUGH RLS ("knocks:
// admins" / "knocks: space stewards"), so only someone who may already see
// that knock can answer it. The recipient is always the knock's own email —
// never caller input. Floors: 3 replies per knock, one per 10 minutes.
//
// verify_jwt = true. Env: RESEND_API_KEY (+ optional NOTIF_FROM, APP_URL).

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
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const linkify = (s: string) => esc(s).replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)])/g,
  '<a href="$1" style="color:#B5552B;text-decoration:underline;">$1</a>');

const svc = (path: string, init?: RequestInit) =>
  fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!RESEND_API_KEY || !SUPABASE_URL || !SERVICE_KEY) return json({ error: 'Not configured' }, 500);

  const auth = req.headers.get('Authorization') ?? '';
  const ures = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: ANON_KEY || SERVICE_KEY, Authorization: auth } });
  const user = ures.ok ? await ures.json().catch(() => null) : null;
  if (!user?.id) return json({ error: 'Sign in to reply' }, 401);

  const body = await req.json().catch(() => ({}));
  const knockId = String(body.knock_id ?? '');
  const message = String(body.message ?? '').trim();
  if (!/^[0-9a-f-]{36}$/.test(knockId)) return json({ error: 'Which knock?' }, 400);
  if (message.length < 2) return json({ error: 'Write a message first.' }, 400);
  if (message.length > 4000) return json({ error: 'That message is too long — keep it under 4,000 characters.' }, 400);

  // Read through RLS with the caller's own token — the authorization.
  const kr = await fetch(`${SUPABASE_URL}/rest/v1/join_requests?id=eq.${knockId}&select=id,name,email,status,space_id,replied_at,reply_count`, {
    headers: { apikey: ANON_KEY || SERVICE_KEY, Authorization: auth },
  });
  const rows = kr.ok ? await kr.json().catch(() => []) : [];
  const k = Array.isArray(rows) ? rows[0] : null;
  if (!k) return json({ error: 'You can’t answer that knock.' }, 403);
  if (k.status === 'spam') return json({ error: 'That knock was marked as spam.' }, 400);
  if (!k.email) return json({ error: 'That knock left no email to reply to.' }, 400);
  if ((k.reply_count ?? 0) >= 3) return json({ error: 'You’ve replied three times already — keep talking from your own inbox (their replies come straight to you).' }, 429);
  if (k.replied_at && Date.now() - new Date(k.replied_at).getTime() < 10 * 60_000) {
    return json({ error: 'You just replied — give it ten minutes before sending another.' }, 429);
  }

  const pr = await svc(`profiles?id=eq.${user.id}&select=full_name`);
  const me = (await pr.json().catch(() => []))?.[0];
  const sender = (me?.full_name as string | undefined)?.trim() || 'Lichen';
  let spaceName: string | null = null;
  if (k.space_id) {
    const sr = await svc(`spaces?id=eq.${k.space_id}&select=name`);
    spaceName = (await sr.json().catch(() => []))?.[0]?.name ?? null;
  }
  const first = String(k.name ?? '').trim().split(/\s+/)[0] || '';
  const where = spaceName ? `${spaceName} on Lichen` : 'Lichen';
  const subject = `${sender} wrote back about your note to ${where}`;
  const stamp = new Date().toLocaleString('en-US', { timeZone: 'America/Denver', dateStyle: 'medium', timeStyle: 'short' });
  const paras = message.split(/\n{2,}/).map((p) => `<p style="margin:0 0 14px;line-height:1.55;">${linkify(p).replace(/\n/g, '<br/>')}</p>`).join('');
  const html = `<!doctype html><html><body style="margin:0;background:#F4EFE6;font-family:Georgia,'Times New Roman',serif;color:#1F2A2E;">
<div style="max-width:560px;margin:0 auto;padding:28px 20px;">
  <div style="background:#FFFFFF;border:1px solid #E5DCCB;border-radius:14px;padding:26px 24px;">
    ${first ? `<p style="margin:0 0 14px;">Hi ${esc(first)},</p>` : ''}
    ${paras}
    <p style="margin:18px 0 0;">— ${esc(sender)}</p>
  </div>
  <p style="font-family:Arial,sans-serif;font-size:12px;color:#7A7F80;line-height:1.5;margin:16px 4px 0;">
    You asked to join ${esc(where)}. This is a personal reply — your request is still with us, and you can simply answer this email to keep talking.
  </p>
  <p style="font-family:Arial,sans-serif;font-size:11px;color:#A2A6A6;margin:8px 4px 0;">Sent ${esc(stamp)}</p>
</div></body></html>`;
  const text = `${first ? `Hi ${first},\n\n` : ''}${message}\n\n— ${sender}\n\nYou asked to join ${where}. This is a personal reply — your request is still with us, and you can simply answer this email to keep talking.\n\nSent ${stamp}`;

  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: `${sender.replace(/[<>"]/g, '')} via Lichen <${FROM_ADDR}>`,
      to: [k.email],
      reply_to: user.email ?? 'connect@lichen.health',
      // A hidden copy to the steward so the whole conversation lives in one
      // inbox thread (founder 2026-11-10) — the knocker never sees it.
      ...(user.email ? { bcc: [user.email] } : {}),
      subject, html, text,
    }),
  });
  if (!r.ok) return json({ error: `The email didn’t go out (${r.status}). Try again in a moment.` }, 502);

  // Stamp only after Resend accepted it — a stamp always means a send.
  const repliedAt = new Date().toISOString();
  await svc(`join_requests?id=eq.${knockId}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ replied_at: repliedAt, reply_count: (k.reply_count ?? 0) + 1, last_reply: message.slice(0, 4000), replied_by: user.id }),
  });
  // The thread (founder 2026-11-10: each knock is a thread) — every reply kept.
  await svc('knock_replies', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ knock_id: knockId, body: message.slice(0, 4000), sent_by: user.id, sent_at: repliedAt }),
  });
  return json({ ok: true, replied_at: repliedAt, to: k.email });
});
