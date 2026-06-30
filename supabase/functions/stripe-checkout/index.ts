// Supabase Edge Function: stripe-checkout
//
// Creates a Stripe Checkout Session (subscription mode) for the logged-in
// member. Calls the Stripe REST API directly with Deno's native fetch — the
// Stripe SDK's bundled HTTP client is unreliable in the Deno edge runtime
// ("connection to Stripe" errors), and fetch is rock-solid here.
//
// Secrets/env: STRIPE_SECRET_KEY (required). Optional: STRIPE_PRODUCT_COMMUNITY
// / STRIPE_PRODUCT_CONCIERGE (default to TEST product IDs), APP_URL.
// SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY are injected.

import { createClient } from 'npm:@supabase/supabase-js@^2';

const STRIPE_KEY = (Deno.env.get('STRIPE_SECRET_KEY') ?? '').trim(); // trim stray newline/space from paste
const TIER_PRODUCT: Record<string, string> = {
  community: Deno.env.get('STRIPE_PRODUCT_COMMUNITY') ?? 'prod_UngbnXiInVtv7V',
  concierge: Deno.env.get('STRIPE_PRODUCT_CONCIERGE') ?? 'prod_UngciE2auur5PE',
};
const APP_URL = (Deno.env.get('APP_URL') ?? 'https://lichen.healthcare').replace(/\/$/, '');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

// Stripe wants nested params as bracketed form keys, e.g. metadata[tier]=x.
function formEncode(obj: Record<string, unknown>, pre = '', out: string[] = []): string {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = pre ? `${pre}[${k}]` : k;
    if (typeof v === 'object') formEncode(v as Record<string, unknown>, key, out);
    else out.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
  }
  return out.join('&');
}

async function stripeGet(path: string) {
  const r = await fetch(`https://api.stripe.com/v1/${path}`, {
    headers: { Authorization: `Bearer ${STRIPE_KEY}` },
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d?.error?.message ?? `Stripe error ${r.status}`);
  return d;
}
async function stripePost(path: string, params: Record<string, unknown>) {
  const r = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${STRIPE_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formEncode(params),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d?.error?.message ?? `Stripe error ${r.status}`);
  return d;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!STRIPE_KEY) return json({ error: 'Billing is not configured yet.' }, 500);

  const authHeader = req.headers.get('Authorization') ?? '';
  const userClient = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json({ error: 'Not signed in.' }, 401);

  let body: { tier?: string };
  try { body = await req.json(); } catch { return json({ error: 'Invalid request body.' }, 400); }
  const tier = body.tier === 'concierge' ? 'concierge' : 'community';
  const productId = TIER_PRODUCT[tier];

  try {
    const prices = await stripeGet(`prices?product=${productId}&active=true&type=recurring&limit=1`);
    const price = prices.data?.[0];
    if (!price) {
      console.error('stripe-checkout: no active price', { tier, productId });
      return json({ error: `No active price found for ${tier} (product ${productId}). Likely a test/live mismatch.` }, 500);
    }

    const admin = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
    const { data: existing } = await admin
      .from('subscriptions').select('stripe_customer_id').eq('profile_id', user.id).maybeSingle();
    const customerId = (existing as { stripe_customer_id: string | null } | null)?.stripe_customer_id ?? null;

    const session = await stripePost('checkout/sessions', {
      mode: 'subscription',
      line_items: { '0': { price: price.id, quantity: 1 } },
      customer: customerId ?? undefined,
      customer_email: customerId ? undefined : (user.email ?? undefined),
      client_reference_id: user.id,
      metadata: { profile_id: user.id, tier },
      subscription_data: { metadata: { profile_id: user.id, tier } },
      allow_promotion_codes: true,
      success_url: `${APP_URL}/membership?status=success`,
      cancel_url: `${APP_URL}/membership?status=cancel`,
    });

    return json({ url: session.url });
  } catch (err) {
    console.error('stripe-checkout error:', err);
    return json({ error: 'Checkout failed', detail: String((err as Error)?.message ?? err) }, 500);
  }
});
