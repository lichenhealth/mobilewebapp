// OPEN IN SAFARI, STILL SIGNED IN (founder 2026-11-26). The iPhone
// home-screen app can't use speech recognition; Safari can. They keep
// separate logins, so:
//   mint  (signed in):  a fresh one-time sign-in for the CALLER's own
//                       account, behind a random code good for 3 minutes.
//   claim (no account): trade the code — once — for that sign-in, which the
//                       browser completes with verifyOtp.
// The code never names anyone; the caller can only ever mint for itself.
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });
const svc = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  let body: { mode?: string; code?: string } = {};
  try { body = await req.json(); } catch { /* */ }

  if (body.mode === 'mint') {
    const auth = req.headers.get('authorization') ?? '';
    const u = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: ANON, Authorization: auth } });
    if (!u.ok) return json({ error: 'Sign in first.' }, 401);
    const user = await u.json() as { id?: string; email?: string };
    if (!user.id || !user.email) return json({ error: 'This account has no email to sign in with.' }, 400);
    const g = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, {
      method: 'POST', headers: svc, body: JSON.stringify({ type: 'magiclink', email: user.email }),
    });
    const link = await g.json().catch(() => ({})) as { hashed_token?: string; properties?: { hashed_token?: string } };
    const hashed = link.hashed_token ?? link.properties?.hashed_token;
    if (!hashed) return json({ error: 'Couldn’t prepare the sign-in.' }, 500);
    const code = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '').slice(0, 8);
    const ins = await fetch(`${SUPABASE_URL}/rest/v1/session_handoffs`, {
      method: 'POST', headers: svc, body: JSON.stringify({ code, profile_id: user.id, token_hash: hashed }),
    });
    if (!ins.ok) return json({ error: 'Couldn’t prepare the sign-in.' }, 500);
    // Old codes don't linger.
    void fetch(`${SUPABASE_URL}/rest/v1/session_handoffs?created_at=lt.${new Date(Date.now() - 3600_000).toISOString()}`, { method: 'DELETE', headers: svc });
    return json({ code });
  }

  if (body.mode === 'claim') {
    const code = String(body.code ?? '');
    if (!/^[0-9a-f]{40}$/.test(code)) return json({ error: 'That link has expired.' }, 400);
    const since = new Date(Date.now() - 180_000).toISOString();
    // Claim atomically: only an unused, fresh row flips.
    const r = await fetch(`${SUPABASE_URL}/rest/v1/session_handoffs?code=eq.${code}&used_at=is.null&created_at=gt.${since}&select=token_hash`, {
      method: 'PATCH', headers: { ...svc, Prefer: 'return=representation' }, body: JSON.stringify({ used_at: new Date().toISOString() }),
    });
    const row = ((await r.json().catch(() => [])) ?? [])[0] as { token_hash?: string } | undefined;
    if (!row?.token_hash) return json({ error: 'That link has expired.' }, 410);
    return json({ token_hash: row.token_hash });
  }
  return json({ error: 'Unknown request.' }, 400);
});
