// Supabase Edge Function: post-checkout
//
// GUEST CHECKOUT for a listing (founder 2026-11-06: "To actually buy the
// item… they'd have to check out as a guest if they didn't wanna join
// lichen"). The guest's private /p/<token> link IS the authorization — the
// booking-checkout posture. The CHARGED AMOUNT is always the order's FROZEN
// price_cents, never caller input, and checkout opens only once the SELLER
// has accepted — nothing is ever charged before their yes. The webhook mints
// the dollars 1:1 as Current-cy to the seller via record_post_payment.
//
// verify_jwt = false. Secrets: STRIPE_SECRET_KEY.

import { createClient } from 'npm:@supabase/supabase-js@^2';

const STRIPE_KEY = (Deno.env.get('STRIPE_SECRET_KEY') ?? '').replace(/[^\x21-\x7E]/g, '');
const APP_URL = (Deno.env.get('APP_URL') ?? 'https://lichen.health').replace(/\/$/, '');
const admin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');

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
  if (!STRIPE_KEY) return json({ error: 'Payments are not configured yet.' }, 500);

  let body: { token?: string };
  try { body = await req.json(); } catch { return json({ error: 'Invalid request body.' }, 400); }
  if (typeof body.token !== 'string' || body.token.length < 32) return json({ error: 'No such link.' }, 404);

  const { data: g } = await admin.from('post_guests').select('id, post_id, email').eq('token', body.token).maybeSingle();
  if (!g) return json({ error: 'No such link.' }, 404);
  const { data: o } = await admin.from('post_orders')
    .select('id, status, price_cents, paid_at, payment_pending_at, buyer_email')
    .eq('guest_id', g.id).in('status', ['requested', 'accepted', 'paid'])
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (!o) return json({ error: 'Ask to buy first — the seller confirms before anything is charged.' }, 400);
  if (o.paid_at || o.status === 'paid') return json({ error: 'Already paid — nothing owed here.' }, 400);
  if (o.payment_pending_at) {
    return json({ error: 'A bank transfer for this is already on its way — it usually clears within a few business days.' }, 400);
  }
  if (o.status !== 'accepted') return json({ error: 'Payment opens once the seller says yes.' }, 400);

  const { data: p } = await admin.from('posts').select('title, body').eq('id', g.post_id).maybeSingle();
  const name = (p?.title?.trim() || String(p?.body ?? '').trim().slice(0, 60) || 'A listing on Lichen');
  const back = `${APP_URL}/p/${body.token}`;

  try {
    const r = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${STRIPE_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formEncode({
        mode: 'payment',
        submit_type: 'pay',
        customer_email: o.buyer_email || g.email || undefined,
        metadata: { kind: 'post_purchase', order: o.id },
        success_url: `${back}?paid=1`,
        cancel_url: back,
        line_items: { '0': { quantity: 1, price_data: {
          currency: 'usd', unit_amount: o.price_cents,
          product_data: { name },
        } } },
      }),
    });
    const session = await r.json();
    if (!r.ok) throw new Error(session?.error?.message ?? `Stripe error ${r.status}`);
    return json({ url: session.url });
  } catch (err) {
    console.error('post-checkout error:', err);
    return json({ error: 'Checkout failed', detail: String((err as Error)?.message ?? err) }, 500);
  }
});
