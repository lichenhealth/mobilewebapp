// Supabase Edge Function: send-push
//
// Invoked by a Database Webhook on INSERT into public.notifications (a SECOND
// webhook alongside send-notification-email — same table, same INSERT event).
// For each new notification it fans a Web Push out to every device the recipient
// has subscribed (push_subscriptions). In-app bells and email are unaffected —
// this is the phone/lock-screen channel.
//
// verify_jwt is OFF (config.toml) so the webhook can reach it; instead it checks
// a shared secret header (x-webhook-secret == NOTIFICATION_WEBHOOK_SECRET — the
// SAME secret the email webhook uses, so no new secret to manage). Subscriptions
// are read with the SERVICE ROLE key (auto-injected).
//
// Secrets/env: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT,
// NOTIFICATION_WEBHOOK_SECRET. SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are
// provided automatically. VAPID keys are generated once (the private half never
// leaves the server; the public half is also hardcoded client-side).

import webpush from 'npm:web-push@3.6.7';

const VAPID_PUBLIC = Deno.env.get('VAPID_PUBLIC_KEY');
const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE_KEY');
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:connect@lichen.health';
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

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
}

interface NotificationRecord {
  recipient_id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
}
interface Subscription { endpoint: string; p256dh: string; auth: string }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  if (!WEBHOOK_SECRET || req.headers.get('x-webhook-secret') !== WEBHOOK_SECRET) {
    return json({ error: 'Unauthorized' }, 401);
  }
  if (!VAPID_PUBLIC || !VAPID_PRIVATE || !SUPABASE_URL || !SERVICE_KEY) {
    return json({ error: 'Push is not fully configured.' }, 500);
  }

  let payload: { type?: string; record?: NotificationRecord };
  try { payload = await req.json(); } catch { return json({ error: 'Invalid body' }, 400); }
  if (payload.type !== 'INSERT' || !payload.record) return json({ ok: true, skipped: 'not-an-insert' });
  const n = payload.record;

  // Read the recipient's subscribed devices with the service role.
  const subRes = await fetch(
    `${SUPABASE_URL}/rest/v1/push_subscriptions?profile_id=eq.${n.recipient_id}&select=endpoint,p256dh,auth`,
    { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } },
  );
  const subs = (await subRes.json().catch(() => [])) as Subscription[];
  if (!Array.isArray(subs) || subs.length === 0) return json({ ok: true, skipped: 'no-devices' });

  const message = JSON.stringify({
    title: n.title || 'Lichen',
    body: n.body || '',
    link: n.link || '/',
    tag: n.type || undefined,
  });

  let sent = 0;
  const dead: string[] = [];
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, message);
      sent++;
    } catch (e) {
      const code = (e as { statusCode?: number })?.statusCode;
      if (code === 404 || code === 410) dead.push(s.endpoint);   // subscription gone
      else console.error('push failed', code, (e as { body?: string })?.body);
    }
  }));

  // Prune expired subscriptions so we stop trying them.
  if (dead.length) {
    const inList = dead.map((e) => `"${e.replace(/"/g, '%22')}"`).join(',');
    await fetch(`${SUPABASE_URL}/rest/v1/push_subscriptions?endpoint=in.(${encodeURIComponent(inList)})`, {
      method: 'DELETE',
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    }).catch(() => {});
  }

  return json({ ok: true, sent, pruned: dead.length });
});
