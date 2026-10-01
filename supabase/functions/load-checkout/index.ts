// Supabase Edge Function: load-checkout
//
// Creates a Stripe Checkout Session that LOADS Current-cy into the signed-in
// member's own wallet — "your Current-cy is like a checking account: you can
// earn it or you can load money into it" (founder 2026-10-01). Dollars in,
// Current minted 1:1 by the stripe-webhook ONLY after Stripe confirms the
// payment (record_currentcy_load, idempotent per session) — the float rule:
// every Current stays backed by a real dollar actually held.
//
// Signed-in ONLY (unlike donate-checkout): a load has an owner by definition.
// No operating share is taken — a load is a purchase of spending power, not
// a gift; $100 becomes 100 Current. It is NOT tax-deductible and the UI must
// never imply it is.
//
// Raw fetch to the Stripe REST API (repo convention — the SDK's HTTP client
// is unreliable in the Deno edge runtime). Secrets: STRIPE_SECRET_KEY.

import { createClient } from 'npm:@supabase/supabase-js@^2';

const STRIPE_KEY = (Deno.env.get('STRIPE_SECRET_KEY') ?? '').replace(/[^\x21-\x7E]/g, '');
const APP_URL = (Deno.env.get('APP_URL') ?? 'https://lichen.health').replace(/\/$/, '');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

function formEncode(obj: Record<string, unknown>, pre = '', out: string[] = []): string {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = pre ? `${pre}[${k}]` : k;
    if (typeof v === 'object') formEncode(v as Record<string, unknown>, key, out);
    else out.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
  }
  return out.join('&');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!STRIPE_KEY) return json({ error: 'Loading is not configured yet.' }, 500);

  let body: { amount?: number };
  try { body = await req.json(); } catch { return json({ error: 'Invalid request body.' }, 400); }

  const dollars = Number(body.amount);
  if (!Number.isFinite(dollars) || dollars < 1 || dollars > 2000) {
    return json({ error: 'Amount must be between $1 and $2,000.' }, 400);
  }
  const cents = Math.round(dollars * 100);

  // The wallet being loaded is ALWAYS the caller's own — no target parameter.
  const auth = req.headers.get('Authorization') ?? '';
  const userClient = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
    global: { headers: { Authorization: auth } },
  });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user?.id) return json({ error: 'Sign in to load your wallet.' }, 401);

  try {
    const r = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${STRIPE_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formEncode({
        mode: 'payment',
        submit_type: 'pay',
        customer_email: user.email || undefined,
        metadata: { kind: 'load', profile: user.id },
        success_url: `${APP_URL}/currentcy?loaded=1`,
        cancel_url: `${APP_URL}/currentcy`,
        line_items: { '0': { quantity: 1, price_data: {
          currency: 'usd', unit_amount: cents,
          product_data: { name: 'Load Current-cy — Lichen wallet' },
        } } },
      }),
    });
    const session = await r.json();
    if (!r.ok) throw new Error(session?.error?.message ?? `Stripe error ${r.status}`);
    return json({ url: session.url });
  } catch (err) {
    console.error('load-checkout error:', err);
    return json({ error: 'Checkout failed', detail: String((err as Error)?.message ?? err) }, 500);
  }
});
