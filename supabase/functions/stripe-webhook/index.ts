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
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const RECEIPT_FROM = Deno.env.get('INVITE_SENDER_FROM') ?? 'Lichen <hello@lichen.healthcare>';
const admin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');

// ── Donation tax receipt (the PROPER 501c3 acknowledgment — carries the EIN
//    and the IRS "no goods or services" language Stripe's receipt lacks).
//    Sponsorships (donor chooses who benefits — the IRS conduit rule) get a
//    GIFT ACKNOWLEDGMENT instead: explicitly NOT a contribution receipt. ────
async function sendDonationReceipt(d: {
  email: string; amountCents: number; designation: string; frequency: string; sessionId: string;
  kind: 'donation' | 'sponsorship';
}): Promise<void> {
  if (!RESEND_API_KEY) return;
  const usd = (d.amountCents / 100).toLocaleString(undefined, { minimumFractionDigits: 2 });
  const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const recurring = d.frequency !== 'one-time' ? ` (${d.frequency})` : '';
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  // Human receipt number, derived from the Stripe session id so webhook
  // retries reproduce the same number. The full machine id stays in the DB.
  const refNo = `LCH-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${d.sessionId.slice(-6).toUpperCase()}`;
  const sponsorship = d.kind === 'sponsorship';
  const docTitle = sponsorship ? 'Gift acknowledgment' : 'Donation receipt';

  const taxText = sponsorship
    ? `This payment is a personal gift you directed to specific people —
it is not a tax-deductible charitable contribution, and this is not
a contribution receipt. Lichen Health facilitates your generosity as
you directed it.`
    : `Lichen Health is a registered 501(c)(3) nonprofit organization,
EIN 73-1683375. Your contribution is tax-deductible to the fullest
extent allowed by law. No goods or services were provided in exchange
for this contribution. Designations are preferences; Lichen Health
retains full discretion and control over all donated funds, as the
IRS requires for tax-deductibility.

Please retain this receipt for your tax records.`;

  const text =
`Thank you for your gift to Lichen Health.

${docTitle.toUpperCase()}
Date: ${date}
Amount: $${usd}${recurring}
${d.designation ? `Directed: "${d.designation}"\n` : ''}Receipt no.: ${refNo}

${taxText}

95% of directed gifts flow to their named recipient as Lichen
Current-cy; 5% sustains the operations that make the platform possible.

With gratitude,
Lichen Health · lichen.healthcare`;

  const html = `<!doctype html><html><body style="margin:0;background:#f3efe9;font-family:Archivo,Helvetica,Arial,sans-serif;color:#2b2b28">
  <div style="max-width:560px;margin:0 auto;padding:32px 24px">
    <img src="https://lichen.healthcare/icons/icon-192.png" width="56" height="56" alt="Lichen"
      style="display:block;border-radius:12px;margin:0 0 10px" />
    <p style="font-size:22px;font-weight:600;margin:0 0 4px">Lichen</p>
    <p style="font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:#8a857c;margin:0 0 20px">${docTitle}</p>
    <p style="font-size:16px;line-height:1.6;margin:0 0 20px">Thank you for your gift — you're expanding access to holistic, community-based care.</p>
    <table style="font-size:14px;line-height:1.8;margin:0 0 20px">
      <tr><td style="color:#8a857c;padding-right:16px">Date</td><td>${date}</td></tr>
      <tr><td style="color:#8a857c;padding-right:16px">Amount</td><td><strong>$${usd}</strong>${recurring}</td></tr>
      ${d.designation ? `<tr><td style="color:#8a857c;padding-right:16px">Directed</td><td>&ldquo;${esc(d.designation)}&rdquo;</td></tr>` : ''}
      <tr><td style="color:#8a857c;padding-right:16px">Receipt no.</td><td>${refNo}</td></tr>
    </table>
    ${sponsorship
      ? `<p style="font-size:12px;color:#6b665e;line-height:1.6;margin:0 0 16px">
      This payment is a personal gift you directed to specific people —
      <strong>it is not a tax-deductible charitable contribution, and this is not
      a contribution receipt.</strong> Lichen Health facilitates your generosity
      as you directed it.
    </p>`
      : `<p style="font-size:12px;color:#6b665e;line-height:1.6;margin:0 0 16px">
      Lichen Health is a registered 501(c)(3) nonprofit organization, EIN 73-1683375.
      Your contribution is tax-deductible to the fullest extent allowed by law.
      <strong>No goods or services were provided in exchange for this contribution.</strong>
      Designations are preferences; Lichen Health retains full discretion and control
      over all donated funds, as the IRS requires for tax-deductibility.
      Please retain this receipt for your tax records.
    </p>`}
    <p style="font-size:12px;color:#8a857c;line-height:1.6;margin:0">
      95% of directed gifts flow to their named recipient as Lichen Current-cy;
      5% sustains the operations that make the platform possible.
    </p>
  </div></body></html>`;

  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: RECEIPT_FROM, to: [d.email],
      subject: `Your Lichen Health ${sponsorship ? 'gift acknowledgment' : 'donation receipt'} — $${usd}`,
      text, html,
    }),
  });
  if (!r.ok) console.error('donation receipt email failed:', await r.text());
}

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
    } else if (event.type === 'checkout.session.completed') {
      // Donations land here (donate-checkout tags them kind=donation) and wait
      // on /admin/supporters for translation into Current-cy (95/5 split).
      // deno-lint-ignore no-explicit-any
      const s = event.data.object as any;
      const giveKind = s.metadata?.kind === 'sponsorship' ? 'sponsorship'
        : s.metadata?.kind === 'donation' ? 'donation' : null;
      if (giveKind && s.payment_status === 'paid') {
        const { data: inserted } = await admin.from('donations').upsert({
          stripe_session_id: s.id,
          amount_cents: s.amount_total ?? 0,
          currency: s.currency ?? 'usd',
          donor_email: s.customer_details?.email ?? null,
          donor_profile_id: s.metadata?.donor_profile || null,
          designation: s.metadata?.designation ?? '',
          frequency: s.metadata?.frequency ?? 'one-time',
          kind: giveKind,
        }, { onConflict: 'stripe_session_id', ignoreDuplicates: true }).select('id');
        // Receipt rides only on FIRST insert — webhook retries never double-send.
        if ((inserted?.length ?? 0) > 0 && s.customer_details?.email) {
          await sendDonationReceipt({
            email: s.customer_details.email,
            amountCents: s.amount_total ?? 0,
            designation: s.metadata?.designation ?? '',
            frequency: s.metadata?.frequency ?? 'one-time',
            sessionId: s.id,
            kind: giveKind,
          });
        }
      }
    }
  } catch (err) {
    console.error('webhook handler error', err);
    return new Response('handler error', { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
});
