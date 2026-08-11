// Supabase Edge Function: admin-cancel-stripe
//
// Immediately cancels a member's Stripe subscription — the server half of two
// admin flows on /admin/supporters (founder 2026-08-11):
//   · "Override with a gift": cancel Stripe billing, then gift_subscription
//     writes the gift row (the hardened stripe-webhook won't let the trailing
//     `deleted` event claw the gift back).
//   · "Revoke & cancel": cancel Stripe billing, then revoke_subscription
//     removes the row.
// Admin-only: the caller's JWT must belong to a profiles.is_admin member.
// Cancels NOW (not at period end) so the DB and Stripe agree immediately.

import { createClient } from 'jsr:@supabase/supabase-js@2';

// Same paste-artifact guard as the other Stripe functions.
const STRIPE_KEY = (Deno.env.get('STRIPE_SECRET_KEY') ?? '').replace(/[^\x21-\x7E]/g, '');

const svc = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  { auth: { persistSession: false } },
);

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  // Caller must be an admin (verify_jwt guarantees a signed-in member; the
  // is_admin check is ours).
  const auth = req.headers.get('Authorization') ?? '';
  const jwt = auth.replace(/^Bearer\s+/i, '');
  let callerId = '';
  try { callerId = (JSON.parse(atob(jwt.split('.')[1] ?? '')) as { sub?: string }).sub ?? ''; } catch { /* fall through */ }
  if (!callerId) return json({ error: 'Not authorized' }, 401);
  const { data: caller } = await svc.from('profiles').select('is_admin').eq('id', callerId).maybeSingle();
  if (!caller?.is_admin) return json({ error: 'Not authorized' }, 403);

  const { profileId } = await req.json().catch(() => ({}));
  if (!profileId) return json({ error: 'profileId required' }, 400);

  const { data: sub } = await svc.from('subscriptions')
    .select('stripe_subscription_id, source')
    .eq('profile_id', profileId)
    .maybeSingle();
  if (!sub?.stripe_subscription_id) {
    // Nothing billing in Stripe — a gift, or already cancelled. Not an error:
    // the caller's next step (gift or revoke) proceeds either way.
    return json({ ok: true, cancelled: false, note: 'No Stripe subscription on file.' });
  }

  const r = await fetch(`https://api.stripe.com/v1/subscriptions/${sub.stripe_subscription_id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${STRIPE_KEY}` },
  });
  if (!r.ok) {
    const detail = await r.text().catch(() => '');
    // "resource_missing" = already gone in Stripe; treat as done.
    if (r.status === 404 || detail.includes('resource_missing')) {
      return json({ ok: true, cancelled: false, note: 'Already gone in Stripe.' });
    }
    return json({ error: `Stripe ${r.status}`, detail: detail.slice(0, 300) }, 502);
  }
  return json({ ok: true, cancelled: true });
});
