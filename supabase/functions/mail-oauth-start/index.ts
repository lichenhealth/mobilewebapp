// Supabase Edge Function: mail-oauth-start (LICHEN MAIL, founder 2026-11-11)
//
// POST (authenticated, Mail testers only).
//  - default: hand back a Google consent URL for connecting a Gmail inbox.
//    State is HMAC-signed so the bare-redirect callback can trust the member.
//  - { action: 'disconnect', accountId }: revoke at Google and forget it.
//
// Secrets: MAIL_GOOGLE_CLIENT_ID, MAIL_GOOGLE_CLIENT_SECRET.
import { MAIL_CLIENT_ID, MAIL_CLIENT_SECRET, mailTester, disconnectMail } from '../_shared/gmail.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const REDIRECT_URI = `${SUPABASE_URL}/functions/v1/mail-oauth-callback`;
const ALLOWED_RETURNS = ['https://lichen.health', 'http://localhost:5173', 'http://localhost:4173'];
const SCOPES = 'https://www.googleapis.com/auth/gmail.modify openid email';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const b64url = (s: string) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function hmac(payload: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(MAIL_CLIENT_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return b64url(String.fromCharCode(...new Uint8Array(sig)));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const auth = req.headers.get('Authorization') ?? '';
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_ANON_KEY, Authorization: auth } });
  if (!userRes.ok) return json({ error: 'Not signed in' }, 401);
  const user = await userRes.json();
  if (!(await mailTester(user.id))) return json({ error: 'Mail is in a personal test right now.' }, 403);

  let body: { action?: string; accountId?: string; returnTo?: string; hint?: string } = {};
  try { body = await req.json(); } catch { /* fine */ }

  if (body.action === 'disconnect') {
    if (!body.accountId) return json({ error: 'accountId required' }, 400);
    await disconnectMail(user.id, body.accountId);
    return json({ ok: true });
  }

  if (!MAIL_CLIENT_ID || !MAIL_CLIENT_SECRET) {
    return json({ error: 'Mail’s Google connection isn’t set up yet — the Google project’s client id and secret still need to go into Lichen’s secrets.' }, 503);
  }
  const returnTo = ALLOWED_RETURNS.includes(body.returnTo ?? '') ? body.returnTo! : ALLOWED_RETURNS[0];
  const ts = Date.now();
  const sig = await hmac(`${user.id}.${ts}.${returnTo}`);
  const state = b64url(JSON.stringify({ u: user.id, t: ts, r: returnTo, s: sig }));
  const hint = typeof body.hint === 'string' && /^[^\s@]+@[^\s@]+$/.test(body.hint) ? `&login_hint=${encodeURIComponent(body.hint)}` : '';
  const url = 'https://accounts.google.com/o/oauth2/v2/auth'
    + `?client_id=${encodeURIComponent(MAIL_CLIENT_ID)}`
    + `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`
    + '&response_type=code'
    + `&scope=${encodeURIComponent(SCOPES)}`
    + '&access_type=offline&prompt=consent%20select_account'
    + hint + `&state=${state}`;
  return json({ url });
});
