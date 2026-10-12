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

// Wording differs by who the invitee will be on the care team. A REMINDER
// (founder 2026-10-12: invitations get "buried in their email") re-sends the
// same invitation gently reframed — the send-invite remind branch's grammar.
function content(role: Role, inviterName: string, email: string, remind = false) {
  const signup = `${APP_URL}/signup`;
  const baseIntro = role === 'caregiver'
    ? `${inviterName} invited you to be a caregiver on their care team on Lichen.`
    : `${inviterName} would like to be part of your care team on Lichen.`;
  const intro = remind ? `In case it got buried: ${baseIntro}` : baseIntro;
  const baseSubject = role === 'caregiver'
    ? `${inviterName} invited you to their care team on Lichen`
    : `${inviterName} wants to support you on Lichen`;
  const subject = remind ? `A gentle reminder — ${baseSubject}` : baseSubject;

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

  let body: { email?: string; role?: Role; inviterName?: string; inviteId?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid request body.' }, 400);
  }

  const inviterName = (body.inviterName ?? 'A Lichen member').trim() || 'A Lichen member';

  // THE GUARDED DOOR (founder 2026-10-12): given an inviteId, the recipient,
  // role and whether this is a REMINDER all come from the row — never caller
  // words — and reminded_at stamps only AFTER Resend accepts (a stamp always
  // means a send). The first email goes any time; later ones wait a day.
  let email = (body.email ?? '').trim();
  let role: Role = body.role === 'patient' ? 'patient' : 'caregiver';
  let remind = false;
  let stampInvite: { id: string; count: number } | null = null;

  const inviteId = (body.inviteId ?? '').trim();
  if (inviteId) {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
    const SERVICE_KEY = (Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '').replace(/[^\x21-\x7E]/g, '');
    if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: 'Not configured.' }, 500);
    // Who's asking — the signed-in sender off the verified JWT.
    let sub = '';
    try {
      const jwt = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
      sub = JSON.parse(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))?.sub ?? '';
    } catch { /* fall through to the mismatch refusal */ }
    const rowRes = await fetch(
      `${SUPABASE_URL}/rest/v1/care_invitations?id=eq.${inviteId}&select=id,inviter_id,invitee_email,role,status,created_at,reminded_at,remind_count`,
      { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } });
    const row = ((await rowRes.json()) as {
      id: string; inviter_id: string; invitee_email: string | null; role: Role;
      status: string; created_at: string; reminded_at: string | null; remind_count: number;
    }[])[0];
    if (!row) return json({ error: 'That invitation no longer exists.' }, 400);
    if (row.status !== 'pending') return json({ error: 'They already joined — nothing to send.' }, 400);
    if (!sub || sub !== row.inviter_id) return json({ error: 'Only the person who invited them can email them.' }, 403);
    if (!row.invitee_email) return json({ error: 'A phone invitation re-sends from your own Messages — use Text.' }, 400);
    if (row.reminded_at && new Date(row.reminded_at).getTime() > Date.now() - 24 * 3600 * 1000) {
      return json({ error: 'Emailed within the last day — give it a little room.' }, 429);
    }
    email = row.invitee_email;
    role = row.role === 'patient' ? 'patient' : 'caregiver';
    remind = !!row.reminded_at; // first guarded send is the invitation; later ones remind
    stampInvite = { id: row.id, count: (row.remind_count ?? 0) + (row.reminded_at ? 1 : 0) };
  }

  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return json({ error: 'A valid recipient email is required.' }, 400);
  }

  const { subject, text, html } = content(role, inviterName, email, remind);

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

  // The stamp lands only after an accepted send.
  if (stampInvite) {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
    const SERVICE_KEY = (Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '').replace(/[^\x21-\x7E]/g, '');
    await fetch(`${SUPABASE_URL}/rest/v1/care_invitations?id=eq.${stampInvite.id}`, {
      method: 'PATCH',
      headers: {
        apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json', Prefer: 'return=minimal',
      },
      body: JSON.stringify({ reminded_at: new Date().toISOString(), remind_count: stampInvite.count }),
    }).catch(() => {});
  }

  const data = await res.json();
  return json({ ok: true, id: data?.id ?? null, reminded: remind });
});
