// Supabase Edge Function: donate-checkout
//
// Creates a Stripe Checkout Session for a DONATION — one-time (payment mode)
// or monthly/annual (subscription mode via inline price_data). Donors may be
// signed OUT (deploy with --no-verify-jwt); a signed-in donor's profile id
// rides along so their gift links to them. The optional `designation` is the
// donor's own words ("for Melanie Bright — subsidize care") — recorded by the
// webhook, resolved by an admin at translation time (95% minted as Current,
// 5% kept as operating dollars).
//
// Raw fetch to the Stripe REST API (repo convention — the SDK's HTTP client
// is unreliable in the Deno edge runtime). Secrets: STRIPE_SECRET_KEY.

import { createClient } from 'npm:@supabase/supabase-js@^2';

const STRIPE_KEY = (Deno.env.get('STRIPE_SECRET_KEY') ?? '').replace(/[^\x21-\x7E]/g, '');
const APP_URL = (Deno.env.get('APP_URL') ?? 'https://lichen.healthcare').replace(/\/$/, '');
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
  if (!STRIPE_KEY) return json({ error: 'Donations are not configured yet.' }, 500);

  let body: { amount?: number; frequency?: string; designation?: string };
  try { body = await req.json(); } catch { return json({ error: 'Invalid request body.' }, 400); }

  const dollars = Number(body.amount);
  if (!Number.isFinite(dollars) || dollars < 1 || dollars > 50000) {
    return json({ error: 'Amount must be between $1 and $50,000.' }, 400);
  }
  const cents = Math.round(dollars * 100);
  const frequency = ['one-time', 'monthly', 'annually'].includes(body.frequency ?? '')
    ? body.frequency as string : 'one-time';
  const designation = (body.designation ?? '').trim().slice(0, 300);

  // Signed-in donors get linked to their profile; signed-out is welcome too.
  // Their account email prefills Checkout (Stripe renders it read-only) so
  // members never retype it and the receipt lands where they already live.
  let donorProfile = '';
  let donorEmail = '';
  const auth = req.headers.get('Authorization') ?? '';
  if (auth) {
    try {
      const userClient = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
        global: { headers: { Authorization: auth } },
      });
      const { data: { user } } = await userClient.auth.getUser();
      donorProfile = user?.id ?? '';
      donorEmail = user?.email ?? '';
    } catch { /* anonymous donor */ }
  }

  const metadata = { kind: 'donation', designation, donor_profile: donorProfile || undefined, frequency };

  try {
    const common = {
      metadata,
      customer_email: donorEmail || undefined,
      success_url: `${APP_URL}/donate?status=success`,
      cancel_url: `${APP_URL}/donate?status=cancelled`,
    };
    const session = frequency === 'one-time'
      ? await stripePost('checkout/sessions', {
          ...common,
          mode: 'payment',
          submit_type: 'donate',
          line_items: { '0': { quantity: 1, price_data: {
            currency: 'usd', unit_amount: cents,
            product_data: { name: 'Donation to Lichen Health' },
          } } },
        })
      : await stripePost('checkout/sessions', {
          ...common,
          mode: 'subscription',
          subscription_data: { metadata },
          line_items: { '0': { quantity: 1, price_data: {
            currency: 'usd', unit_amount: cents,
            recurring: { interval: frequency === 'monthly' ? 'month' : 'year' },
            product_data: { name: `${frequency === 'monthly' ? 'Monthly' : 'Annual'} donation to Lichen Health` },
          } } },
        });

    return json({ url: session.url });
  } catch (err) {
    console.error('donate-checkout error:', err);
    return json({ error: 'Checkout failed', detail: String((err as Error)?.message ?? err) }, 500);
  }
});
