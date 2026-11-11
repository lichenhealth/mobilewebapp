// Supabase Edge Function: mail-oauth-callback (LICHEN MAIL)
//
// GET — Google sends the member's browser here after consent. Deployed with
// --no-verify-jwt; trust comes from the HMAC-signed state mail-oauth-start
// minted. Stores the refresh token server-side (mail_tokens — no policies,
// service role only) and bounces back to /mail.
import { MAIL_CLIENT_ID, MAIL_CLIENT_SECRET } from '../_shared/gmail.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const REDIRECT_URI = `${SUPABASE_URL}/functions/v1/mail-oauth-callback`;
const b64url = (s: string) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (s: string) => atob(s.replace(/-/g, '+').replace(/_/g, '/'));

async function hmac(payload: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(MAIL_CLIENT_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return b64url(String.fromCharCode(...new Uint8Array(sig)));
}
const back = (returnTo: string, q: string) => new Response(null, { status: 302, headers: { Location: `${returnTo}/mail?${q}` } });

Deno.serve(async (req) => {
  const params = new URL(req.url).searchParams;
  let returnTo = 'https://lichen.health';
  try {
    const state = JSON.parse(fromB64url(params.get('state') ?? '')) as { u: string; t: number; r: string; s: string };
    if ((await hmac(`${state.u}.${state.t}.${state.r}`)) !== state.s) return back(returnTo, 'mail=error');
    returnTo = state.r;
    if (Date.now() - state.t > 15 * 60_000) return back(returnTo, 'mail=expired');
    if (params.get('error') || !params.get('code')) return back(returnTo, 'mail=denied');
    const scope = params.get('scope') ?? '';
    if (!scope.includes('gmail.modify')) return back(returnTo, 'mail=noscope');

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code: params.get('code')!, client_id: MAIL_CLIENT_ID, client_secret: MAIL_CLIENT_SECRET, redirect_uri: REDIRECT_URI, grant_type: 'authorization_code' }),
    });
    if (!tokenRes.ok) return back(returnTo, 'mail=error');
    const tok = await tokenRes.json() as { refresh_token?: string; access_token?: string; expires_in?: number; id_token?: string };
    if (!tok.refresh_token) return back(returnTo, 'mail=error');
    let email = '';
    try { email = JSON.parse(fromB64url(tok.id_token!.split('.')[1])).email ?? ''; } catch { /* below */ }
    if (!email) return back(returnTo, 'mail=error');

    const svc = { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}`, 'Content-Type': 'application/json' };
    // Reconnecting the same inbox replaces its row (and token) — never a duplicate.
    await fetch(`${SUPABASE_URL}/rest/v1/mail_accounts?profile_id=eq.${state.u}&email=ilike.${encodeURIComponent(email)}`,
      { method: 'DELETE', headers: { ...svc, Prefer: 'return=minimal' } });
    const created = await (await fetch(`${SUPABASE_URL}/rest/v1/mail_accounts`, {
      method: 'POST', headers: { ...svc, Prefer: 'return=representation' },
      body: JSON.stringify({ profile_id: state.u, email }),
    })).json();
    const accountId = created?.[0]?.id;
    if (!accountId) return back(returnTo, 'mail=error');
    await fetch(`${SUPABASE_URL}/rest/v1/mail_tokens`, {
      method: 'POST', headers: { ...svc, Prefer: 'return=minimal' },
      body: JSON.stringify({
        account_id: accountId, refresh_token: tok.refresh_token, access_token: tok.access_token ?? null,
        expires_at: tok.expires_in ? new Date(Date.now() + tok.expires_in * 1000).toISOString() : null,
      }),
    });
    return back(returnTo, `mail=connected&account=${encodeURIComponent(email)}`);
  } catch {
    return back(returnTo, 'mail=error');
  }
});
