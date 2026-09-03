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

function content(inviterName: string, note: string, giftTier: string, giftMonths: number | null, token: string | null, mission?: string, seat?: { spaceName: string; role: 'member' | 'admin' }) {
  const signup = token ? `${APP_URL}/signup?invite=${token}` : `${APP_URL}/signup`;
  // A way to say no (founder 2026-08-17): closes the invitation, tells the
  // inviter quietly, and no reminder ever follows.
  const decline = token ? `${APP_URL}/invite/decline?token=${token}` : null;
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

  // The "sweet note" — welcome framing (founder 2026-09-03, second pass:
  // "let people in"): no gate, one honest alpha line, and the Alpha Tester
  // group as the self-selected door for those who feel called to help
  // build. Kept in step with Invite.tsx's DEFAULT_MISSION.
  const DEFAULT_MISSION =
    `Thanks in advance for your (precious) time. The foundation of the corrective social network and healthcare `
    + `system is built, much is still in development, and there will be bugs along the way. Come use the network `
    + `as it grows — and if you feel called to help build it out, let Galyn know: members who want to give `
    + `feedback are invited into the Alpha Tester group, where suggestions become features. We're grateful to be `
    + `building it with you.`;
  // An admin may rewrite this paragraph before sending (founder 2026-08-06:
  // "give you the boilerplate language as a template to edit"). Empty falls
  // back to the standard words.
  const missionText = (mission ?? '').trim() || DEFAULT_MISSION;
  // Everyone gets 3 months free on signup (growth phase) — framed as a
  // co-creation window, not a trial. A specific admin gift supersedes it.
  const trial = giftLine ? '' :
    `Your first 3 months are on us. Use them to make Lichen yours — tell us what you need, help us build it out, and be part of the beginning of a better world.`;

  // Invite-with-a-seat (founder 2026-09-03): the email says plainly which
  // space and role ride this invitation — the click on it is the consent.
  const seatLine = seat
    ? (seat.role === 'admin'
        ? `The moment you join, you'll also step into ${seat.spaceName} as an admin — its page and backstage will be yours to steward.`
        : `The moment you join, you'll also become a member of ${seat.spaceName}.`)
    : '';

  const parts = [intro, missionText];
  if (seatLine) parts.push(seatLine);
  if (note) parts.push(`They added a note:\n"${note}"`);
  if (giftLine) parts.push(giftLine);
  else if (trial) parts.push(trial);
  const text = parts.join('\n\n') + `\n\nJoin here:\n${signup}`
    + (decline ? `\n\nNot for you right now? Let us know and we won't follow up:\n${decline}` : '')
    + `\n\n— Lichen`;

  // A rewritten mission is escaped and paragraphed; the default keeps its
  // hand-set emphasis.
  const missionHtml = (mission ?? '').trim()
    ? missionText.split(/\n{2,}/).filter(Boolean).map((para) =>
        `<p style="font-size:15px;line-height:1.6;margin:0 0 20px;color:#4a463f">${esc(para)}</p>`).join('')
    : `<p style="font-size:15px;line-height:1.6;margin:0 0 20px;color:#4a463f"><strong>Thanks in advance</strong> for your (precious) time. The foundation of the <em>corrective</em> social network and healthcare system is built, much is still in development, and there will be bugs along the way. Come use the network as it grows — and if you feel called to help build it out, let Galyn know: members who want to give feedback are invited into the <strong>Alpha Tester group</strong>, where suggestions become features. We're grateful to be building it with you.</p>`;
  const seatHtml = seatLine
    ? `<p style="font-size:15px;line-height:1.5;margin:0 0 20px;color:#2b2b28"><strong>${esc(seatLine)}</strong></p>`
    : '';
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
    ${seatHtml}
    ${noteHtml}
    ${giftHtml}
    ${trialHtml}
    <p style="margin:0 0 28px">
      <a href="${signup}" style="display:inline-block;background:#e8956b;color:#fff;text-decoration:none;padding:12px 22px;border-radius:999px;font-weight:600">Join on Lichen</a>
    </p>
    <p style="font-size:13px;color:#8a857c;line-height:1.5;margin:0">If you weren't expecting this, you can safely ignore it.${decline ? ` Not for you right now? <a href="${decline}" style="color:#8a857c">Decline the invitation</a> and we won't follow up.` : ''}</p>
  </div></body></html>`;

  return { subject, text, html };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  if (!RESEND_API_KEY) return json({ error: 'Email is not configured yet (missing RESEND_API_KEY).' }, 500);

  let body: { email?: string; inviterName?: string; note?: string; giftTier?: string; giftMonths?: number; mission?: string; space_id?: string; space_role?: string };
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

  // Who is asking? (verify_jwt guarantees a member; the sub is the minter.)
  let sub: string | null = null;
  try {
    const auth = req.headers.get('Authorization') ?? '';
    const jwt = auth.replace(/^Bearer\s+/i, '');
    sub = (JSON.parse(atob(jwt.split('.')[1] ?? '')) as { sub?: string }).sub ?? null;
  } catch { /* no sub, no mint */ }

  // Invite-with-a-seat (founder 2026-09-03): the invite may carry a space +
  // role. Authority is checked HERE at mint time — an admin-carrying invite
  // needs the space's super admin, a member invite needs an admin — and the
  // seat_from_invite trigger re-checks the same rule at claim time, so the
  // email can never promise a seat the sender couldn't grant.
  let seat: { spaceName: string; role: 'member' | 'admin' } | undefined;
  let seatCols: { space_id: string; space_role: string } | null = null;
  const spaceId = (body.space_id ?? '').trim();
  if (spaceId) {
    const spaceRole = (body.space_role ?? 'member').trim().toLowerCase();
    if (!/^[0-9a-f-]{36}$/.test(spaceId) || !['member', 'admin'].includes(spaceRole)) {
      return json({ error: 'Invalid space invitation.' }, 400);
    }
    if (!sub) return json({ error: 'Sign in to invite someone to a space.' }, 401);
    const { data: myRow } = await svc.from('space_members')
      .select('role').eq('space_id', spaceId).eq('profile_id', sub).maybeSingle();
    const myRole = (myRow as { role?: string } | null)?.role ?? '';
    const allowed = spaceRole === 'admin' ? myRole === 'super_admin' : ['admin', 'super_admin'].includes(myRole);
    if (!allowed) {
      return json({ error: spaceRole === 'admin'
        ? 'Only the super admin can invite someone in as an admin.'
        : 'Only an admin can invite someone into this space.' }, 403);
    }
    const { data: sp } = await svc.from('spaces')
      .select('name, status').eq('id', spaceId).maybeSingle();
    const spRow = sp as { name?: string; status?: string | null } | null;
    if (!spRow?.name || spRow.status === 'offline') {
      return json({ error: 'That space isn’t reachable right now.' }, 400);
    }
    seat = { spaceName: spRow.name, role: spaceRole as 'member' | 'admin' };
    seatCols = { space_id: spaceId, space_role: spaceRole };
  }

  // Mint the token as the CALLER.
  let token: string | null = null;
  try {
    if (sub) {
      const { data: tok } = await svc.from('invite_tokens')
        .insert({ created_by: sub, invitee_email: email, ...(seatCols ?? {}) })
        .select('token').single();
      token = (tok as { token: string } | null)?.token ?? null;
    }
  } catch (e) { console.error('token mint:', e); }

  const mission = (body.mission ?? '').trim().slice(0, 2000);
  const { subject, text, html } = content(inviterName, note, giftTier, giftMonths, token, mission, seat);

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
    // The token was minted BEFORE the send — leaving it behind makes a
    // failed email indistinguishable from a delivered invitation on
    // /invite (2026-08-11 audit, bug 3). Un-mint it.
    if (token) {
      await svc.from('invite_tokens').delete().eq('token', token).is('claimed_by', null);
    }
    return json({ error: 'Email provider rejected the send.', detail }, 502);
  }

  const data = await res.json();
  return json({ ok: true, id: data?.id ?? null });
});
