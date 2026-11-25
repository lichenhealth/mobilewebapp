// Supabase Edge Function: coupons-ext
//
// THE LICHEN BROWSER EXTENSION's one door (founder 2026-11-25). The extension
// sends its token (minted by mint_extension_token, shown to it once at
// pairing) in the x-lichen-ext header; this answers with that member's own
// coupons and nothing else. The extension does the matching locally — this
// function never learns which site the member is on.
//
// Deployed --no-verify-jwt: the token IS the authorization.

const SUPABASE_URL = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/$/, '');
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'x-lichen-ext, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const svc = (path: string, init: RequestInit = {}) => fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
  ...init,
  headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
});

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const token = (req.headers.get('x-lichen-ext') ?? '').trim();
  if (!/^lx_[0-9a-f]{48}$/.test(token)) return json({ error: 'Not connected.' }, 401);
  try {
    const hash = await sha256(token);
    const rows = await (await svc(`extension_tokens?token_hash=eq.${hash}&select=id,profile_id`)).json();
    const t = Array.isArray(rows) ? rows[0] : null;
    if (!t) return json({ error: 'This browser was disconnected from Lichen. Connect it again from Profile → Connections.' }, 401);
    await svc(`extension_tokens?id=eq.${t.id}`, { method: 'PATCH', body: JSON.stringify({ last_used_at: new Date().toISOString() }) });
    const [pr, cr] = await Promise.all([
      svc(`profiles?id=eq.${t.profile_id}&select=first_name,full_name`),
      svc(`coupons?profile_id=eq.${t.profile_id}&select=id,merchant,offer,code,min_spend_cents,expires_on,terms,url,where_valid&order=expires_on.asc.nullslast&limit=200`),
    ]);
    const p = ((await pr.json()) ?? [])[0] ?? {};
    const coupons = await cr.json();
    return json({
      name: p.first_name || (p.full_name ?? '').split(' ')[0] || '',
      coupons: Array.isArray(coupons) ? coupons : [],
    });
  } catch (e) {
    console.error('coupons-ext', e);
    return json({ error: 'Something went wrong — try again.' }, 500);
  }
});
