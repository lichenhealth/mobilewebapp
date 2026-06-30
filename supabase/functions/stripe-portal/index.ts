// Supabase Edge Function: stripe-portal
//
// Opens the Stripe Billing Portal for an existing member so they can upgrade
// (Community ↔ Concierge), update their card, or cancel. Stripe hosts the UI
// and emits webhooks that stripe-webhook uses to update the subscription —
// so upgrades/cancellations flow back into our `subscriptions` table for free.
//
// Requires the Customer Portal to be configured in the Stripe dashboard
// (Settings → Billing → Customer portal), allowing switching between the
// Community and Concierge prices.
//
// Secrets/env: STRIPE_SECRET_KEY. APP_URL optional. JWT verification stays ON.

import Stripe from 'npm:stripe@^17';
import { createClient } from 'npm:@supabase/supabase-js@^2';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', {
  apiVersion: '2024-12-18.acacia',
  httpClient: Stripe.createFetchHttpClient(), // required in the Deno edge runtime
});
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

  const authHeader = req.headers.get('Authorization') ?? '';
  const userClient = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json({ error: 'Not signed in.' }, 401);

  const admin = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
  const { data: sub } = await admin
    .from('subscriptions').select('stripe_customer_id').eq('profile_id', user.id).maybeSingle();
  const customerId = (sub as { stripe_customer_id: string | null } | null)?.stripe_customer_id ?? null;
  if (!customerId) return json({ error: 'No billing account yet — subscribe first.' }, 400);

  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${APP_URL}/membership`,
  });
  return json({ url: session.url });
});
