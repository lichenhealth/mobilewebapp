// Supabase Edge Function: send-gift-notice
//
// Emails an EXISTING member that an admin gifted them a Lichen membership
// ("Galyn gifted you 6 months of Lichen"). Invoked from the Invite screen's
// existing-member gift path and from Memberships & gifts. The in-app bell
// notification is written by gift_subscription() itself — this email is the
// out-of-app echo.
//
// Unlike send-invite (any member may invite), this email asserts a gift was
// made, so the caller must be an ADMIN: we resolve the caller from their JWT
// and check profiles.is_admin before sending. Requires RESEND_API_KEY.

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const FROM = Deno.env.get('INVITE_SENDER_FROM') ?? 'Lichen <hello@lichen.healthcare>';
const APP_URL = (Deno.env.get('APP_URL') ?? 'https://lichen.healthcare').replace(/\/$/, '');
const REPLY_TO = Deno.env.get('INVITE_REPLY_TO') ?? 'connect@lichen.health';
// Auto-injected into every edge function.
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

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

function spanText(months: number | null): string {
  if (!months) return '';
  if (months % 12 === 0) return months === 12 ? 'a year' : `${months / 12} years`;
  return months === 1 ? 'a month' : `${months} months`;
}

function content(inviterName: string, tier: string, months: number | null) {
  const tierLabel = tier === 'concierge' ? 'Concierge' : 'Community';
  const span = spanText(months);
  const line = span
    ? `${inviterName} gifted you ${span} of Lichen (${tierLabel} membership).`
    : `${inviterName} gifted you a Lichen ${tierLabel} membership.`;
  const subject = `${inviterName} gifted you Lichen`;

  const text =
    `${line}\n\n` +
    `It's already active on your account — just sign in:\n${APP_URL}\n\n` +
    `— Lichen`;

  const html = `<!doctype html><html><body style="margin:0;background:#f3efe9;font-family:Archivo,Helvetica,Arial,sans-serif;color:#2b2b28">
  <div style="max-width:520px;margin:0 auto;padding:32px 24px">
    <p style="font-size:22px;font-weight:600;margin:0 0 16px">Lichen</p>
    <p style="font-size:16px;line-height:1.5;margin:0 0 20px">${esc(line)}</p>
    <p style="font-size:16px;line-height:1.5;margin:0 0 24px">It's already active on your account — just sign in.</p>
    <p style="margin:0 0 28px">
      <a href="${APP_URL}" style="display:inline-block;background:#e8956b;color:#fff;text-decoration:none;padding:12px 22px;border-radius:999px;font-weight:600">Open Lichen</a>
    </p>
    <p style="font-size:13px;color:#8a857c;line-height:1.5;margin:0">If you weren't expecting this, you can safely ignore it.</p>
  </div></body></html>`;

  return { subject, text, html };
}

/** The caller must be a signed-in admin — this email asserts a gift exists. */
async function callerIsAdmin(req: Request): Promise<boolean> {
  const auth = req.headers.get('Authorization') ?? '';
  if (!auth || !SUPABASE_URL || !SUPABASE_ANON_KEY) return false;
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: auth },
  });
  if (!userRes.ok) return false;
  const user = await userRes.json();
  if (!user?.id) return false;
  const profRes = await fetch(
    `${SUPABASE_URL}/rest/v1/profiles?id=eq.${user.id}&select=is_admin`,
    { headers: { apikey: SUPABASE_ANON_KEY, Authorization: auth } },
  );
  if (!profRes.ok) return false;
  const rows = await profRes.json();
  return rows?.[0]?.is_admin === true;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  if (!RESEND_API_KEY) return json({ error: 'Email is not configured yet (missing RESEND_API_KEY).' }, 500);

  if (!(await callerIsAdmin(req))) return json({ error: 'Not authorized.' }, 403);

  let body: { email?: string; inviterName?: string; tier?: string; months?: number };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid request body.' }, 400);
  }

  const email = (body.email ?? '').trim();
  const inviterName = (body.inviterName ?? '').trim() || 'A friend on Lichen';
  const tier = (body.tier ?? 'community').trim().toLowerCase();
  const months = Number.isFinite(body.months) && (body.months as number) > 0
    ? Math.round(body.months as number) : null;

  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return json({ error: 'A valid recipient email is required.' }, 400);
  }

  const { subject, text, html } = content(inviterName, tier, months);

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
