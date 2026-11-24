// Supabase Edge Function: service-connect
//
// CONNECTIONS (founder 2026-11-24: "how can we make this more seamless and
// easy for non technical lichen users and their other services"). A member
// links their OWN account at an outside service whose only door is a key —
// Twilio first. The key is checked against the service BEFORE it is stored,
// stored locked to the member (service_secrets: RLS on, no policies), and
// never sent back to the browser again.
//
// POST { action: 'connect', service: 'twilio', account_sid, key_sid, key_secret }
//      { action: 'disconnect', service }
//      { action: 'status', service }   → numbers on the account (live)
//
// verify_jwt = true. The caller is the member; there is no target parameter.

import { TWILIO_SHAPES, twilioCreds, twilioGet, twilioNumbers, type TwilioCreds } from '../_shared/twilio.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });
const svc = (path: string, init?: RequestInit) =>
  fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const auth = req.headers.get('Authorization') ?? '';
  const ures = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: ANON_KEY || SERVICE_KEY, Authorization: auth } });
  const user = ures.ok ? await ures.json().catch(() => null) : null;
  if (!user?.id) return json({ error: 'Sign in first.' }, 401);
  const me = String(user.id);

  const body = await req.json().catch(() => ({}));
  const action = String(body.action ?? '');
  const service = String(body.service ?? '');
  if (service !== 'twilio') return json({ error: 'Lichen can connect Twilio so far.' }, 400);

  if (action === 'disconnect') {
    await svc(`service_connections?profile_id=eq.${me}&service=eq.twilio`, { method: 'DELETE' });
    return json({ ok: true });
  }

  if (action === 'status') {
    const c = await twilioCreds(me);
    if (!c) return json({ ok: true, connected: false });
    try {
      return json({ ok: true, connected: true, numbers: await twilioNumbers(c) });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await svc(`service_connections?profile_id=eq.${me}&service=eq.twilio`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'error', last_error: msg }) });
      return json({ ok: false, connected: true, error: msg });
    }
  }

  if (action !== 'connect') return json({ error: 'Unknown action.' }, 400);

  // Paste artifacts (spaces, invisible marks) never make a key "wrong".
  const clean = (v: unknown) => String(v ?? '').replace(/[^\x21-\x7E]/g, '').trim();
  const creds: TwilioCreds = { account_sid: clean(body.account_sid), key_sid: clean(body.key_sid), key_secret: clean(body.key_secret) };
  if (!TWILIO_SHAPES.account.test(creds.account_sid)) return json({ error: 'The Account SID starts with AC and is 34 characters — it’s on your Twilio console home page.' }, 400);
  if (!TWILIO_SHAPES.key.test(creds.key_sid)) return json({ error: 'The API key SID starts with SK and is 34 characters — Twilio shows it when you create the key.' }, 400);
  if (!TWILIO_SHAPES.secret.test(creds.key_secret)) return json({ error: 'The key’s secret is 32 letters and numbers — Twilio shows it once, when you create the key.' }, 400);

  // Check it with Twilio before anything is stored.
  let label = '';
  try {
    const acct = await twilioGet(creds, '.json');
    label = `${String(acct.friendly_name ?? 'Twilio account')} · …${creds.account_sid.slice(-4)}`;
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Twilio didn’t accept those keys.' }, 400);
  }

  const up = await svc('service_connections?on_conflict=profile_id,service', {
    method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify({ profile_id: me, service: 'twilio', label, status: 'connected', last_error: null, connected_at: new Date().toISOString() }),
  });
  const row = (await up.json().catch(() => []))?.[0];
  if (!row?.id) return json({ error: 'Couldn’t save the connection — try again.' }, 500);
  const sec = await svc('service_secrets?on_conflict=connection_id', {
    method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ connection_id: row.id, secret: creds }),
  });
  if (!sec.ok) {
    await svc(`service_connections?id=eq.${row.id}`, { method: 'DELETE' });
    return json({ error: 'Couldn’t save the connection — try again.' }, 500);
  }
  let numbers: unknown[] = [];
  try { numbers = await twilioNumbers(creds); } catch { /* the account still connected */ }
  return json({ ok: true, label, numbers });
});
