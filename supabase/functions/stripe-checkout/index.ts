// Supabase Edge Function: stripe-checkout
//
// Creates a Stripe Checkout Session (subscription mode) for the logged-in
// member to subscribe to Community or Concierge. Returns the hosted Checkout
// URL; the frontend redirects there. The actual `subscriptions` row is written
// by the stripe-webhook function once Stripe confirms payment.
//
// Secrets/env: STRIPE_SECRET_KEY (required). Optional overrides:
//   STRIPE_PRODUCT_COMMUNITY / STRIPE_PRODUCT_CONCIERGE (default to the current
//   TEST product IDs), APP_URL (default https://lichen.healthcare).
// SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY are injected.
//
// JWT verification stays ON — only a logged-in member can start checkout.

import Stripe from 'npm:stripe@^17';
import { createClient } from 'npm:@supabase/supabase-js@^2';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', {
  apiVersion: '2024-12-18.acacia',
  httpClient: Stripe.createFetchHttpClient(), // required in the Deno edge runtime
});

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!Deno.env.get('STRIPE_SECRET_KEY')) return json({ error: 'Billing is not configured yet.' }, 500);

  // Identify the caller from their Supabase JWT.
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

  // Resolve the active recurring price for the product (so we never hardcode price IDs).
  const prices = await stripe.prices.list({ product: productId, active: true, type: 'recurring', limit: 1 });
  const price = prices.data[0];
  if (!price) return json({ error: `No active price found for the ${tier} plan.` }, 500);

  // Reuse an existing Stripe customer if this member already has one.
  const admin = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
  const { data: existing } = await admin
    .from('subscriptions').select('stripe_customer_id').eq('profile_id', user.id).maybeSingle();
  const customerId = (existing as { stripe_customer_id: string | null } | null)?.stripe_customer_id ?? null;

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price: price.id, quantity: 1 }],
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
});
