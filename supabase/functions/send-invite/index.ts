// Supabase Edge Function: send-invite
//
// Sends a general "join Lichen" invitation email via Resend. Invoked from the
// Invite screen (`supabase.functions.invoke('send-invite', { body })`) when a
// member invites someone to become a member. Unlike send-care-invite, this is
// NOT tied to a care team — it just emails a signup link.
//
// Requires the secret RESEND_API_KEY. Optional: INVITE_SENDER_FROM (defaults to
// "Lichen <hello@lichen.healthcare>") and APP_URL (defaults to
// https://lichen.healthcare). JWT verification stays ON so only logged-in
// members can trigger sends.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
// Invite-only Lichen (founder 2026-07-28): every emailed invite carries a
// TOKEN — signup requires one, and claiming it weaves inviter and invitee
// into each other's mycelium.
const svc = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  { auth: { persistSession: false } },
);
const FROM = Deno.env.get('INVITE_SENDER_FROM') ?? 'Lichen <hello@lichen.healthcare>';
const APP_URL = (Deno.env.get('APP_URL') ?? 'https://lichen.healthcare').replace(/\/$/, '');
// A real, monitored inbox (lichen.healthcare is send-only, so replies must land on
// lichen.health). Replies + an unsubscribe header both improve deliverability.
const REPLY_TO = Deno.env.get('INVITE_REPLY_TO') ?? 'connect@lichen.health';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function content(inviterName: string, note: string, giftTier: string, giftMonths: number | null, token: string | null) {
  const signup = token ? `${APP_URL}/signup?invite=${token}` : `${APP_URL}/signup`;
  const subject = `${inviterName} invited you to Lichen`;
  const intro = `${inviterName} thinks you'd find a place at Lichen — a community for holistic care and a more humane, conscious economy.`;

  const giftLabel = giftTier === 'concierge' ? 'Concierge' : giftTier === 'community' ? 'Community' : '';
  const span = giftMonths
    ? (giftMonths % 12 === 0
        ? (giftMonths === 12 ? 'a year' : `${giftMonths / 12} years`)
        : giftMonths === 1 ? 'a month' : `${giftMonths} months`)
    : '';
  const giftLine = giftLabel
    ? (span
        ? `This invitation includes a gift: ${span} of Lichen (${giftLabel} membership) — yours from the moment you sign up.`
        : `This invitation includes a gifted ${giftLabel} membership — Lichen is yours from the moment you sign up.`)
    : '';

  // The "sweet note" — what Lichen is, and the invitation to help build it.
  const mission =
    `We're building something different — a corrective social network. One trusted web for the whole of a life: `
    + `care, work and offerings, jobs, events, the places we gather, and a fairer economy — made to help us actually `
    + `be in relationship, not perform for one another. It's early, and that's the invitation: come build it with us — `
    + `shape it, test it, ship it — the beginning of a better world.`;
  // Everyone gets 3 months free on signup (growth phase) — framed as a
  // co-creation window, not a trial. A specific admin gift supersedes it.
  const trial = giftLine ? '' :
    `Your first 3 months are on us. Use them to make Lichen yours — tell us what you need, help us build it out, and be part of the beginning of a better world.`;

  const parts = [intro, mission];
  if (note) parts.push(`They added a note:\n"${note}"`);
  if (giftLine) parts.push(giftLine);
  else if (trial) parts.push(trial);
  const text = parts.join('\n\n') + `\n\nJoin here:\n${signup}\n\n— Lichen`;

  const missionHtml = `<p style="font-size:15px;line-height:1.6;margin:0 0 20px;color:#4a463f">We're building something different — a <em>corrective</em> social network. One trusted web for the whole of a life: care, work and offerings, jobs, events, the places we gather, and a fairer economy — made to help us actually be in relationship, not perform for one another. It's early, and that's the invitation: come build it with us — shape it, test it, ship it — the beginning of a better world.</p>`;
  const noteHtml = note
    ? `<p style="font-size:15px;line-height:1.5;margin:0 0 20px;padding:12px 16px;background:#fff;border-radius:12px;color:#4a463f">${esc(note)}</p>`
    : '';
  const giftHtml = giftLine
    ? `<p style="font-size:15px;line-height:1.5;margin:0 0 20px;color:#2b2b28"><strong>${esc(giftLine)}</strong></p>`
    : '';
  const trialHtml = (giftLine || !trial)
    ? ''
    : `<p style="font-size:15px;line-height:1.5;margin:0 0 20px;padding:12px 16px;background:#f6efe8;border-radius:12px;color:#2b2b28"><strong>${esc(trial)}</strong></p>`;

  const html = `<!doctype html><html><body style="margin:0;background:#f3efe9;font-family:Archivo,Helvetica,Arial,sans-serif;color:#2b2b28">
  <div style="max-width:520px;margin:0 auto;padding:32px 24px">
    <p style="font-size:22px;font-weight:600;margin:0 0 16px">Lichen</p>
    <p style="font-size:16px;line-height:1.5;margin:0 0 20px">${esc(intro)}</p>
    ${missionHtml}
    ${noteHtml}
    ${giftHtml}
    ${trialHtml}
    <p style="margin:0 0 28px">
      <a href="${signup}" style="display:inline-block;background:#e8956b;color:#fff;text-decoration:none;padding:12px 22px;border-radius:999px;font-weight:600">Join on Lichen</a>
    </p>
    <p style="font-size:13px;color:#8a857c;line-height:1.5;margin:0">If you weren't expecting this, you can safely ignore it.</p>
  </div></body></html>`;

  return { subject, text, html };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  if (!RESEND_API_KEY) return json({ error: 'Email is not configured yet (missing RESEND_API_KEY).' }, 500);

  let body: { email?: string; inviterName?: string; note?: string; giftTier?: string; giftMonths?: number };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid request body.' }, 400);
  }

  const email = (body.email ?? '').trim();
  const inviterName = (body.inviterName ?? '').trim() || 'A friend on Lichen';
  const note = (body.note ?? '').trim().slice(0, 500);
  // Cosmetic only — the gift itself lives in membership_gifts, written by the
  // admin-gated client flow; a forged giftTier here just decorates an email.
  const giftTier = (body.giftTier ?? '').trim().toLowerCase();
  const giftMonths = Number.isFinite(body.giftMonths) && (body.giftMonths as number) > 0
    ? Math.round(body.giftMonths as number) : null;

  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return json({ error: 'A valid recipient email is required.' }, 400);
  }

  // Mint the token as the CALLER (verify_jwt guarantees a member).
  let token: string | null = null;
  try {
    const auth = req.headers.get('Authorization') ?? '';
    const jwt = auth.replace(/^Bearer\s+/i, '');
    const payload = JSON.parse(atob(jwt.split('.')[1] ?? '')) as { sub?: string };
    if (payload.sub) {
      const { data: tok } = await svc.from('invite_tokens')
        .insert({ created_by: payload.sub, invitee_email: email })
        .select('token').single();
      token = (tok as { token: string } | null)?.token ?? null;
    }
  } catch (e) { console.error('token mint:', e); }

  const { subject, text, html } = content(inviterName, note, giftTier, giftMonths, token);

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: FROM, to: [email], reply_to: REPLY_TO, subject, text, html,
      headers: { 'List-Unsubscribe': `<mailto:${REPLY_TO}?subject=unsubscribe>` },
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    return json({ error: 'Email provider rejected the send.', detail }, 502);
  }

  const data = await res.json();
  return json({ ok: true, id: data?.id ?? null });
});
