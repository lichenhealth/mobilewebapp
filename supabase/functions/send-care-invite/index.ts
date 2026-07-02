// Supabase Edge Function: send-care-invite
//
// Sends a care-team invitation email via Resend. Invoked from the Profile
// screen (`supabase.functions.invoke('send-care-invite', { body })`) when a
// member clicks "Send email" on a pending invite.
//
// Requires the secret RESEND_API_KEY (set with `supabase secrets set`).
// Optional: INVITE_FROM (defaults to "Lichen <care@lichen.healthcare>") and
// APP_URL (defaults to https://lichen.healthcare).
//
// JWT verification is left ON (the default), so only logged-in members can
// trigger sends — this keeps the endpoint from being abused anonymously.

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const FROM = Deno.env.get('INVITE_FROM') ?? 'Lichen <care@lichen.healthcare>';
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

type Role = 'caregiver' | 'patient';

// Wording differs by who the invitee will be on the care team.
function content(role: Role, inviterName: string, email: string) {
  const signup = `${APP_URL}/signup`;
  const intro = role === 'caregiver'
    ? `${inviterName} invited you to be a caregiver on their care team on Lichen.`
    : `${inviterName} would like to be part of your care team on Lichen.`;
  const subject = role === 'caregiver'
    ? `${inviterName} invited you to their care team on Lichen`
    : `${inviterName} wants to support you on Lichen`;

  const text =
    `${intro}\n\n` +
    `To connect, sign up with this email (${email}) and you'll be linked automatically:\n${signup}\n\n` +
    `— Lichen`;

  const html = `<!doctype html><html><body style="margin:0;background:#f3efe9;font-family:Archivo,Helvetica,Arial,sans-serif;color:#2b2b28">
  <div style="max-width:520px;margin:0 auto;padding:32px 24px">
    <p style="font-size:22px;font-weight:600;margin:0 0 16px">Lichen</p>
    <p style="font-size:16px;line-height:1.5;margin:0 0 20px">${intro}</p>
    <p style="font-size:16px;line-height:1.5;margin:0 0 24px">Sign up with this email — <strong>${email}</strong> — and you'll be connected automatically.</p>
    <p style="margin:0 0 28px">
      <a href="${signup}" style="display:inline-block;background:#e8956b;color:#fff;text-decoration:none;padding:12px 22px;border-radius:999px;font-weight:600">Join on Lichen</a>
    </p>
    <p style="font-size:13px;color:#8a857c;line-height:1.5;margin:0">If you weren't expecting this, you can ignore it — nothing happens until you sign up.</p>
  </div></body></html>`;

  return { subject, text, html };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  if (!RESEND_API_KEY) return json({ error: 'Email is not configured yet (missing RESEND_API_KEY).' }, 500);

  let body: { email?: string; role?: Role; inviterName?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid request body.' }, 400);
  }

  const email = (body.email ?? '').trim();
  const role: Role = body.role === 'patient' ? 'patient' : 'caregiver';
  const inviterName = (body.inviterName ?? 'A Lichen member').trim() || 'A Lichen member';

  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return json({ error: 'A valid recipient email is required.' }, 400);
  }

  const { subject, text, html } = content(role, inviterName, email);

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
