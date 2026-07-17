// Supabase Edge Function: google-oauth-callback
//
// GET — Google redirects the member's browser here after consent. Deployed
// with --no-verify-jwt (the redirect carries no Supabase auth); trust comes
// from the HMAC-signed state minted by google-oauth-start. Exchanges the
// code, stores the refresh token server-side (google_calendar_accounts —
// deny-all RLS, service role only), creates the visible external_calendars
// row ('google:<account id>'), and bounces back to Calendar settings.
//
// Secrets: GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const CLIENT_ID = Deno.env.get('GOOGLE_OAUTH_CLIENT_ID') ?? '';
const CLIENT_SECRET = Deno.env.get('GOOGLE_OAUTH_CLIENT_SECRET') ?? '';
const REDIRECT_URI = `${SUPABASE_URL}/functions/v1/google-oauth-callback`;

const b64url = (s: string) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (s: string) => atob(s.replace(/-/g, '+').replace(/_/g, '/'));

async function hmac(payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(CLIENT_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return b64url(String.fromCharCode(...new Uint8Array(sig)));
}

const back = (returnTo: string, q: string) =>
  new Response(null, { status: 302, headers: { Location: `${returnTo}/calendar/settings?${q}` } });

Deno.serve(async (req) => {
  const params = new URL(req.url).searchParams;
  let returnTo = 'https://lichen.healthcare';
  try {
    const state = JSON.parse(fromB64url(params.get('state') ?? '')) as { u: string; t: number; r: string; s: string };
    if ((await hmac(`${state.u}.${state.t}.${state.r}`)) !== state.s) return back(returnTo, 'google=error');
    returnTo = state.r;
    if (Date.now() - state.t > 15 * 60_000) return back(returnTo, 'google=expired');
    if (params.get('error') || !params.get('code')) return back(returnTo, 'google=denied');

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: params.get('code')!,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
        grant_type: 'authorization_code',
      }),
    });
    if (!tokenRes.ok) return back(returnTo, 'google=error');
    const tok = await tokenRes.json() as { refresh_token?: string; id_token?: string };
    if (!tok.refresh_token) return back(returnTo, 'google=error');

    // Email label from the id_token payload (fresh from Google over TLS).
    let email = 'Google Calendar';
    try {
      const payload = JSON.parse(fromB64url(tok.id_token!.split('.')[1]));
      if (typeof payload.email === 'string') email = payload.email;
    } catch { /* label only */ }

    const svc = {
      apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}`,
      'Content-Type': 'application/json',
    };
    // One connection per Google account per member — replace, don't duplicate.
    const existing = await (await fetch(
      `${SUPABASE_URL}/rest/v1/google_calendar_accounts?select=id&profile_id=eq.${state.u}&google_email=eq.${encodeURIComponent(email)}`,
      { headers: svc })).json();
    for (const row of Array.isArray(existing) ? existing : []) {
      await fetch(`${SUPABASE_URL}/rest/v1/external_calendars?profile_id=eq.${state.u}&url=eq.${encodeURIComponent('google:' + row.id)}`,
        { method: 'DELETE', headers: { ...svc, Prefer: 'return=minimal' } });
      await fetch(`${SUPABASE_URL}/rest/v1/google_calendar_accounts?id=eq.${row.id}`,
        { method: 'DELETE', headers: { ...svc, Prefer: 'return=minimal' } });
    }

    const created = await (await fetch(`${SUPABASE_URL}/rest/v1/google_calendar_accounts`, {
      method: 'POST', headers: { ...svc, Prefer: 'return=representation' },
      body: JSON.stringify({ profile_id: state.u, google_email: email, refresh_token: tok.refresh_token }),
    })).json();
    const accountId = created?.[0]?.id;
    if (!accountId) return back(returnTo, 'google=error');

    await fetch(`${SUPABASE_URL}/rest/v1/external_calendars`, {
      method: 'POST', headers: { ...svc, Prefer: 'return=minimal' },
      body: JSON.stringify({ profile_id: state.u, name: email, url: 'google:' + accountId }),
    });
    return back(returnTo, 'google=connected');
  } catch {
    return back(returnTo, 'google=error');
  }
});
