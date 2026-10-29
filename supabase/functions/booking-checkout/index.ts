// Supabase Edge Function: booking-checkout
//
// Creates a Stripe Checkout Session for a PRICED booking (founder
// 2026-10-29: payments on bookings — "Let's do both"). The dollars land in
// Lichen's Stripe; the webhook then mints Current 1:1 to the PROVIDER (or
// opens an auto cash-out, their payout_pref) via record_booking_payment —
// the float rule: every minted Current is backed by a dollar actually held.
//
// verify_jwt = false: a GUEST pays with their booking token as the whole
// authorization (the /b/<token> pattern); a MEMBER passes their JWT and the
// booking id, and must be the booker. The CHARGED AMOUNT is always the
// booking row's FROZEN price_cents — never caller input.
//
// Payment never charges before the provider's yes: a request-type booking
// pays only once CONFIRMED; an instant booking pays right after booking.
//
// Raw fetch to the Stripe REST API (repo convention). Secrets: STRIPE_SECRET_KEY.

import { createClient } from 'npm:@supabase/supabase-js@^2';

const STRIPE_KEY = (Deno.env.get('STRIPE_SECRET_KEY') ?? '').replace(/[^\x21-\x7E]/g, '');
const APP_URL = (Deno.env.get('APP_URL') ?? 'https://lichen.health').replace(/\/$/, '');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const admin = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');

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

  let body: { token?: string; booking_id?: string };
  try { body = await req.json(); } catch { return json({ error: 'Invalid request body.' }, 400); }

  // Resolve the booking by GUEST TOKEN (the unguessable string IS the
  // authorization) or by id + the caller's own JWT (must be the booker).
  const SEL = 'id, type_id, provider_id, booker_id, status, price_cents, paid_at, guest_token, guest_email, on_date';
  // deno-lint-ignore no-explicit-any
  let b: any = null;
  if (typeof body.token === 'string' && body.token.length >= 32) {
    const { data } = await admin.from('bookings').select(SEL).eq('guest_token', body.token).maybeSingle();
    b = data;
  } else if (typeof body.booking_id === 'string') {
    const auth = req.headers.get('Authorization') ?? '';
    const userClient = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
      global: { headers: { Authorization: auth } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user?.id) return json({ error: 'Sign in to pay for this booking.' }, 401);
    const { data } = await admin.from('bookings').select(SEL).eq('id', body.booking_id).maybeSingle();
    if (data && data.booker_id !== user.id) return json({ error: 'Not your booking.' }, 403);
    b = data;
  }
  if (!b) return json({ error: 'No such booking.' }, 404);

  if (!b.price_cents || b.price_cents <= 0) return json({ error: 'This session has no online payment.' }, 400);
  if (b.paid_at) return json({ error: 'Already paid — nothing owed here.' }, 400);
  if (b.status === 'cancelled' || b.status === 'declined') {
    return json({ error: 'This booking is no longer held, so there is nothing to pay.' }, 400);
  }
  // A request-type booking pays only once the provider has said yes — nothing
  // is ever charged before their confirmation, so declines never need refunds.
  const { data: t } = await admin.from('booking_types')
    .select('title, approval, profile_id').eq('id', b.type_id).maybeSingle();
  if (b.status === 'pending' && t?.approval !== 'instant') {
    return json({ error: 'Payment opens once the provider confirms this request.' }, 400);
  }

  const { data: prov } = await admin.from('profiles')
    .select('full_name').eq('id', b.provider_id).maybeSingle();
  const name = `${t?.title ?? 'A session'} — ${prov?.full_name ?? 'a Lichen member'}`;
  const back = b.guest_token ? `${APP_URL}/b/${b.guest_token}` : `${APP_URL}/bookings`;

  try {
    const r = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${STRIPE_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formEncode({
        mode: 'payment',
        submit_type: 'pay',
        customer_email: b.guest_email || undefined,
        metadata: { kind: 'booking_payment', booking: b.id },
        success_url: `${back}${back.includes('?') ? '&' : '?'}paid=1`,
        cancel_url: back,
        line_items: { '0': { quantity: 1, price_data: {
          currency: 'usd', unit_amount: b.price_cents,
          product_data: { name },
        } } },
      }),
    });
    const session = await r.json();
    if (!r.ok) throw new Error(session?.error?.message ?? `Stripe error ${r.status}`);
    return json({ url: session.url });
  } catch (err) {
    console.error('booking-checkout error:', err);
    return json({ error: 'Checkout failed', detail: String((err as Error)?.message ?? err) }, 500);
  }
});
