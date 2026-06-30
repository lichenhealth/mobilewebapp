// Supabase Edge Function: stripe-webhook
//
// Keeps `subscriptions` in sync with Stripe. On each subscription event it
// re-fetches the subscription's CURRENT status from Stripe (authoritative) so
// out-of-order or early "incomplete" events can't leave a stale status.
//
// Deploy with `--no-verify-jwt` (config.toml handles this). Stripe can't send a
// Supabase JWT — the request is authenticated by the Stripe signature instead.
//
// Secrets/env: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET. SUPABASE_URL /
// SUPABASE_SERVICE_ROLE_KEY are injected.

import Stripe from 'npm:stripe@^17';
import { createClient } from 'npm:@supabase/supabase-js@^2';

const STRIPE_KEY = (Deno.env.get('STRIPE_SECRET_KEY') ?? '').replace(/[^\x21-\x7E]/g, '');
const WEBHOOK_SECRET = (Deno.env.get('STRIPE_WEBHOOK_SECRET') ?? '').replace(/[^\x21-\x7E]/g, '');
const admin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');

// SDK is used ONLY for local signature verification (no network call).
const stripe = new Stripe(STRIPE_KEY, { apiVersion: '2024-12-18.acacia', httpClient: Stripe.createFetchHttpClient() });
const cryptoProvider = Stripe.createSubtleCryptoProvider();

const PRODUCT_TIER: Record<string, 'community' | 'concierge'> = {
  [Deno.env.get('STRIPE_PRODUCT_COMMUNITY') ?? 'prod_SHphERWwRzXVak']: 'community',
  [Deno.env.get('STRIPE_PRODUCT_CONCIERGE') ?? 'prod_SHpjCV2Jcfkeuo']: 'concierge',
};

// Collapse Stripe's many statuses into our CHECK-constrained set.
function mapStatus(s: string): 'active' | 'past_due' | 'canceled' {
  if (s === 'active' || s === 'trialing') return 'active';
  if (s === 'past_due' || s === 'unpaid' || s === 'incomplete') return 'past_due';
  return 'canceled';
}

// deno-lint-ignore no-explicit-any
function tierFromSubscription(sub: any): 'community' | 'concierge' {
  return PRODUCT_TIER[sub.items?.data?.[0]?.price?.product as string] ?? 'community';
}

async function fetchSubscription(id: string) {
  const r = await fetch(`https://api.stripe.com/v1/subscriptions/${id}`, {
    headers: { Authorization: `Bearer ${STRIPE_KEY}` },
  });
  if (!r.ok) throw new Error(`Stripe ${r.status}`);
  return r.json();
}

// deno-lint-ignore no-explicit-any
async function record(subFromEvent: any, isDeleted: boolean) {
  const profileId = subFromEvent.metadata?.profile_id;
  if (!profileId) return; // not one of ours

  // For create/update, fetch the authoritative current state (avoids stale or
  // out-of-order event payloads). For delete, the sub is gone — use the event.
  let sub = subFromEvent;
  if (!isDeleted) {
    try { sub = await fetchSubscription(subFromEvent.id); } catch { /* fall back to event payload */ }
  }

  await admin.from('subscriptions').upsert({
    profile_id: profileId,
    tier: tierFromSubscription(sub),
    source: 'stripe',
    status: isDeleted ? 'canceled' : mapStatus(sub.status),
    stripe_customer_id: sub.customer,
    stripe_subscription_id: sub.id,
    current_period_end: sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null,
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
    if (event.type === 'customer.subscription.deleted') {
      await record(event.data.object, true);
    } else if (event.type === 'customer.subscription.created' || event.type === 'customer.subscription.updated') {
      await record(event.data.object, false);
    }
  } catch (err) {
    console.error('webhook handler error', err);
    return new Response('handler error', { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
});
