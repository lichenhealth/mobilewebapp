// Supabase Edge Function: stripe-webhook
//
// Receives Stripe events and keeps the `subscriptions` table in sync. This is
// the source of truth for a member's tier/status — never trust the client.
//
// IMPORTANT: deploy with `--no-verify-jwt` (Stripe can't send a Supabase JWT;
// we authenticate the request via the Stripe signature instead).
//
// Secrets/env: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET (both required).
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are injected.

import Stripe from 'npm:stripe@^17';
import { createClient } from 'npm:@supabase/supabase-js@^2';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', {
  apiVersion: '2024-12-18.acacia',
  httpClient: Stripe.createFetchHttpClient(), // required in the Deno edge runtime
});
// Deno has no Node crypto; use Web Crypto for async signature verification.
const cryptoProvider = Stripe.createSubtleCryptoProvider();
const WEBHOOK_SECRET = (Deno.env.get('STRIPE_WEBHOOK_SECRET') ?? '').trim();
const admin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');

// Map a Stripe product back to our tier. Mirrors stripe-checkout.
const PRODUCT_TIER: Record<string, 'community' | 'concierge'> = {
  [Deno.env.get('STRIPE_PRODUCT_COMMUNITY') ?? 'prod_UngbnXiInVtv7V']: 'community',
  [Deno.env.get('STRIPE_PRODUCT_CONCIERGE') ?? 'prod_UngciE2auur5PE']: 'concierge',
};

// Collapse Stripe's many statuses into our CHECK-constrained set.
function mapStatus(s: string): 'active' | 'past_due' | 'canceled' {
  if (s === 'active' || s === 'trialing') return 'active';
  if (s === 'past_due' || s === 'unpaid' || s === 'incomplete') return 'past_due';
  return 'canceled'; // canceled, incomplete_expired, paused, …
}

function tierFromSubscription(sub: Stripe.Subscription): 'community' | 'concierge' {
  const productId = sub.items.data[0]?.price.product as string;
  return PRODUCT_TIER[productId] ?? 'community';
}

async function upsert(sub: Stripe.Subscription) {
  const profileId = sub.metadata?.profile_id;
  if (!profileId) return; // not one of ours
  await admin.from('subscriptions').upsert({
    profile_id: profileId,
    tier: tierFromSubscription(sub),
    source: 'stripe',
    status: mapStatus(sub.status),
    stripe_customer_id: sub.customer as string,
    stripe_subscription_id: sub.id,
    current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'profile_id' });
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const sig = req.headers.get('stripe-signature');
  if (!sig || !WEBHOOK_SECRET) return new Response('Missing signature', { status: 400 });

  const raw = await req.text();
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(raw, sig, WEBHOOK_SECRET, undefined, cryptoProvider);
  } catch (err) {
    return new Response(`Webhook signature failed: ${(err as Error).message}`, { status: 400 });
  }

  try {
    switch (event.type) {
      // The subscription is recorded straight from these events — each carries
      // the full Subscription object plus our metadata.profile_id — so no extra
      // Stripe API call is needed (checkout.session.completed is ignored).
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        await upsert(event.data.object as Stripe.Subscription);
        break;
      }
      default:
        break; // ignore everything else
    }
  } catch (err) {
    // Log and 500 so Stripe retries.
    console.error('webhook handler error', err);
    return new Response('handler error', { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
});
