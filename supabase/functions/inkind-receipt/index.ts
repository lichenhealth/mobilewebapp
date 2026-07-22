// Supabase Edge Function: inkind-receipt
//
// Sends the NONCASH DONATION ACKNOWLEDGMENT for an accepted in-kind donation
// (the Goodwill-style receipt — legal because title passed to Lichen).
// Called by an ADMIN from the routing desk right after accept_inkind_donation;
// admin status is re-verified server-side. Per IRS rules the acknowledgment
// DESCRIBES the property and never states a value — valuation is the donor's.
// Idempotent: refuses to send twice (receipt_sent_at gate).
//
// Secrets: RESEND_API_KEY (project-wide). verify_jwt stays ON.

import { createClient } from 'npm:@supabase/supabase-js@^2';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const FROM = Deno.env.get('INVITE_SENDER_FROM') ?? 'Lichen <hello@lichen.healthcare>';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

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

  let body: { id?: string };
  try { body = await req.json(); } catch { return json({ error: 'Invalid body' }, 400); }
  if (!body.id) return json({ error: 'Missing donation id' }, 400);

  // Re-verify the caller is an admin — the JWT alone isn't enough.
  const auth = req.headers.get('Authorization') ?? '';
  const userClient = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
    global: { headers: { Authorization: auth } },
  });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json({ error: 'Not signed in' }, 401);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: me } = await admin.from('profiles').select('is_admin').eq('id', user.id).single();
  if (!me?.is_admin) return json({ error: 'Admins only' }, 403);

  const { data: d } = await admin.from('inkind_donations')
    .select('id, description, status, accepted_at, receipt_sent_at, donor_profile_id')
    .eq('id', body.id).single();
  if (!d) return json({ error: 'No such donation' }, 404);
  if (d.status !== 'accepted') return json({ error: 'Not accepted yet' }, 400);
  if (d.receipt_sent_at) return json({ ok: true, already: true });

  const { data: donor } = await admin.from('profiles')
    .select('email, full_name').eq('id', d.donor_profile_id).single();
  if (!donor?.email) return json({ error: 'Donor has no email on file' }, 400);
  if (!RESEND_API_KEY) return json({ error: 'Email is not configured' }, 500);

  const date = new Date(d.accepted_at ?? Date.now()).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  });
  const refNo = `LCH-IK-${(d.accepted_at ?? '').slice(0, 10).replace(/-/g, '')}-${d.id.slice(0, 6).toUpperCase()}`;
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const text =
`Thank you for your donation to Lichen Health.

NONCASH DONATION ACKNOWLEDGMENT
Date accepted: ${date}
Donated property: ${d.description}
Receipt no.: ${refNo}

Lichen Health is a registered 501(c)(3) nonprofit organization,
EIN 73-1683375. No goods or services were provided in exchange for
this contribution. Lichen Health has not assigned a value to the
donated property — determining fair market value is the donor's
responsibility. For noncash donations over $500, see IRS Form 8283.

Please retain this acknowledgment for your tax records.

With gratitude,
Lichen Health · lichen.healthcare`;

  const html = `<!doctype html><html><body style="margin:0;background:#f3efe9;font-family:Archivo,Helvetica,Arial,sans-serif;color:#2b2b28">
  <div style="max-width:560px;margin:0 auto;padding:32px 24px">
    <img src="https://lichen.healthcare/icons/icon-192.png" width="56" height="56" alt="Lichen"
      style="display:block;border-radius:12px;margin:0 0 10px" />
    <p style="font-size:22px;font-weight:600;margin:0 0 4px">Lichen</p>
    <p style="font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:#8a857c;margin:0 0 20px">Noncash donation acknowledgment</p>
    <p style="font-size:16px;line-height:1.6;margin:0 0 20px">Thank you — your donated property is now part of the commons, routed where it&rsquo;s needed most.</p>
    <table style="font-size:14px;line-height:1.8;margin:0 0 20px">
      <tr><td style="color:#8a857c;padding-right:16px">Date accepted</td><td>${date}</td></tr>
      <tr><td style="color:#8a857c;padding-right:16px">Property</td><td>${esc(d.description)}</td></tr>
      <tr><td style="color:#8a857c;padding-right:16px">Receipt no.</td><td>${refNo}</td></tr>
    </table>
    <p style="font-size:12px;color:#6b665e;line-height:1.6;margin:0 0 16px">
      Lichen Health is a registered 501(c)(3) nonprofit organization, EIN 73-1683375.
      <strong>No goods or services were provided in exchange for this contribution.</strong>
      Lichen Health has not assigned a value to the donated property — determining fair
      market value is the donor&rsquo;s responsibility. For noncash donations over $500,
      see IRS Form 8283. Please retain this acknowledgment for your tax records.
    </p>
  </div></body></html>`;

  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: FROM, to: [donor.email],
      subject: 'Your Lichen Health donation acknowledgment',
      text, html,
    }),
  });
  if (!r.ok) {
    console.error('inkind receipt email failed:', await r.text());
    return json({ error: 'Email failed' }, 500);
  }

  await admin.from('inkind_donations')
    .update({ receipt_sent_at: new Date().toISOString() }).eq('id', d.id);
  return json({ ok: true });
});
