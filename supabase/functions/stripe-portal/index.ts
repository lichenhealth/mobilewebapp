// Supabase Edge Function: stripe-portal
//
// Opens the Stripe Billing Portal for an existing member (upgrade Community ↔
// Concierge, update card, cancel). Calls the Stripe REST API directly with
// fetch — the SDK's HTTP client is unreliable in the Deno edge runtime.
//
// Requires the Customer Portal to be configured in the Stripe dashboard
// (Settings → Billing → Customer portal), allowing the two prices to switch.
//
// Secrets/env: STRIPE_SECRET_KEY. APP_URL optional. JWT verification stays ON.

import { createClient } from 'npm:@supabase/supabase-js@^2';

const STRIPE_KEY = (Deno.env.get('STRIPE_SECRET_KEY') ?? '').trim(); // trim stray newline/space from paste
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
  if (!STRIPE_KEY) return json({ error: 'Billing is not configured yet.' }, 500);

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

  try {
    const r = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${STRIPE_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `customer=${encodeURIComponent(customerId)}&return_url=${encodeURIComponent(`${APP_URL}/membership`)}`,
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d?.error?.message ?? `Stripe error ${r.status}`);
    return json({ url: d.url });
  } catch (err) {
    console.error('stripe-portal error:', err);
    return json({ error: 'Could not open billing', detail: String((err as Error)?.message ?? err) }, 500);
  }
});
