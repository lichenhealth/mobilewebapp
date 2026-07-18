// Supabase Edge Function: google-oauth-start
//
// POST (authenticated). Two jobs:
//  - default: hand the app a Google consent URL for the one-tap calendar
//    connection. State is HMAC-signed with the client secret so the callback
//    (which arrives as a bare browser redirect) can trust the member id.
//  - { action: 'disconnect', accountId }: remove a Google connection — the
//    token row (service role; clients can never touch it) and its
//    external_calendars face (cascades the imported busy blocks).
//
// Secrets: GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const CLIENT_ID = Deno.env.get('GOOGLE_OAUTH_CLIENT_ID') ?? '';
const CLIENT_SECRET = Deno.env.get('GOOGLE_OAUTH_CLIENT_SECRET') ?? '';

const REDIRECT_URI = `${SUPABASE_URL}/functions/v1/google-oauth-callback`;
const ALLOWED_RETURNS = ['https://lichen.healthcare', 'http://localhost:5173'];

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const b64url = (s: string) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function hmac(payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(CLIENT_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return b64url(String.fromCharCode(...new Uint8Array(sig)));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  if (!CLIENT_ID || !CLIENT_SECRET) return json({ error: 'Google connection isn’t configured yet' }, 503);

  const auth = req.headers.get('Authorization') ?? '';
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_ANON_KEY, Authorization: auth } });
  if (!userRes.ok) return json({ error: 'Not signed in' }, 401);
  const user = await userRes.json();

  let body: { action?: string; accountId?: string; returnTo?: string } = {};
  try { body = await req.json(); } catch { /* fine */ }

  if (body.action === 'disconnect') {
    if (!body.accountId) return json({ error: 'accountId required' }, 400);
    const svc = { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}`, Prefer: 'return=minimal' };
    await fetch(`${SUPABASE_URL}/rest/v1/external_calendars?profile_id=eq.${user.id}&url=eq.${encodeURIComponent('google:' + body.accountId)}`,
      { method: 'DELETE', headers: svc });
    await fetch(`${SUPABASE_URL}/rest/v1/google_calendar_accounts?id=eq.${body.accountId}&profile_id=eq.${user.id}`,
      { method: 'DELETE', headers: svc });
    return json({ ok: true });
  }

  const returnTo = ALLOWED_RETURNS.includes(body.returnTo ?? '') ? body.returnTo! : ALLOWED_RETURNS[0];
  const ts = Date.now();
  const sig = await hmac(`${user.id}.${ts}.${returnTo}`);
  const state = b64url(JSON.stringify({ u: user.id, t: ts, r: returnTo, s: sig }));

  const url = 'https://accounts.google.com/o/oauth2/v2/auth'
    + `?client_id=${encodeURIComponent(CLIENT_ID)}`
    + `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`
    + '&response_type=code'
    + `&scope=${encodeURIComponent('https://www.googleapis.com/auth/calendar.readonly openid email')}`
    + '&access_type=offline&prompt=consent&include_granted_scopes=true'
    + `&state=${state}`;
  return json({ url });
});
