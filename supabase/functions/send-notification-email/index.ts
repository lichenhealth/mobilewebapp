// Supabase Edge Function: send-notification-email
//
// Invoked by a Database Webhook on INSERT into public.notifications. For each new
// notification, if the recipient opted into email (profiles.email_notifications),
// it sends a copy via Resend. In-app notifications are unaffected — this is only
// the optional email channel.
//
// verify_jwt is OFF (config.toml) so the webhook can reach it; instead it checks a
// shared secret header (x-webhook-secret == NOTIFICATION_WEBHOOK_SECRET). The
// recipient's email is column-locked from `authenticated`, so we read it with the
// SERVICE ROLE key (auto-injected in the edge runtime).
//
// Secrets/env: RESEND_API_KEY, NOTIFICATION_WEBHOOK_SECRET (set via `supabase
// secrets set`). Optional: NOTIF_FROM, INVITE_REPLY_TO, APP_URL. SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY are provided automatically.

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const FROM = Deno.env.get('NOTIF_FROM') ?? 'Lichen <hello@lichen.healthcare>';
const REPLY_TO = Deno.env.get('INVITE_REPLY_TO') ?? 'connect@lichen.health';
const APP_URL = (Deno.env.get('APP_URL') ?? 'https://lichen.healthcare').replace(/\/$/, '');
const WEBHOOK_SECRET = Deno.env.get('NOTIFICATION_WEBHOOK_SECRET');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-webhook-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

interface NotificationRecord {
  recipient_id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  // Authenticate the webhook via shared secret.
  if (!WEBHOOK_SECRET || req.headers.get('x-webhook-secret') !== WEBHOOK_SECRET) {
    return json({ error: 'Unauthorized' }, 401);
  }
  if (!RESEND_API_KEY || !SUPABASE_URL || !SERVICE_KEY) {
    return json({ error: 'Email is not fully configured.' }, 500);
  }

  let payload: { type?: string; record?: NotificationRecord };
  try { payload = await req.json(); } catch { return json({ error: 'Invalid body' }, 400); }
  if (payload.type !== 'INSERT' || !payload.record) return json({ ok: true, skipped: 'not-an-insert' });

  const n = payload.record;

  // Look up the recipient's email + preference with the service role (bypasses the
  // email column lock). Skip silently if they haven't opted in.
  const profRes = await fetch(
    `${SUPABASE_URL}/rest/v1/profiles?id=eq.${n.recipient_id}&select=email,email_notifications`,
    { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } },
  );
  const profs = await profRes.json().catch(() => []);
  const prof = Array.isArray(profs) ? profs[0] : null;
  if (!prof?.email || !prof.email_notifications) return json({ ok: true, skipped: 'opted-out' });

  const url = `${APP_URL}${n.link ?? ''}`;
  const line = `${n.title}${n.body ? ` ${n.body}` : ''}`;
  const subject = `Lichen · ${n.title}`;
  const text = `${line}\n\nOpen Lichen:\n${url}\n\n— Lichen\n\n` +
    `You're getting this because email notifications are on. Turn them off in your Lichen profile.`;
  const html = `<!doctype html><html><body style="margin:0;background:#f3efe9;font-family:Archivo,Helvetica,Arial,sans-serif;color:#2b2b28">
  <div style="max-width:520px;margin:0 auto;padding:32px 24px">
    <p style="font-size:22px;font-weight:600;margin:0 0 16px">Lichen</p>
    <p style="font-size:16px;line-height:1.5;margin:0 0 24px">${esc(line)}</p>
    <p style="margin:0 0 28px">
      <a href="${url}" style="display:inline-block;background:#e8956b;color:#fff;text-decoration:none;padding:12px 22px;border-radius:999px;font-weight:600">Open Lichen</a>
    </p>
    <p style="font-size:13px;color:#8a857c;line-height:1.5;margin:0">You're getting this because email notifications are on. You can turn them off in your Lichen profile.</p>
  </div></body></html>`;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: FROM, to: [prof.email], reply_to: REPLY_TO, subject, text, html,
      headers: { 'List-Unsubscribe': `<mailto:${REPLY_TO}?subject=unsubscribe>` },
    }),
  });
  if (!res.ok) return json({ error: 'Resend rejected the send', detail: await res.text() }, 502);
  const data = await res.json();
  return json({ ok: true, id: data?.id ?? null });
});
