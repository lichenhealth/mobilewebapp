// Supabase Edge Function: send-booking-mail
//
// Guest-facing booking mails for the PUBLIC booking link (founder
// 2026-08-14, the Calendly replacement). The caller supplies only a token;
// everything in the mail is derived from the booking's CURRENT state in the
// database, so nothing about the content is forgeable — the worst an
// attacker with a random string can do is trigger no email at all.
// verify_jwt = false: guests are signed out by definition.
// Secrets: RESEND_API_KEY (set). From lichen.healthcare (send-only domain),
// replies land on connect@lichen.health — the standing pattern.

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const FROM = Deno.env.get('NOTIF_FROM') ?? 'Lichen <hello@lichen.healthcare>';
const REPLY_TO = Deno.env.get('INVITE_REPLY_TO') ?? 'connect@lichen.health';
const APP_URL = Deno.env.get('APP_URL') ?? 'https://lichen.health';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const minToLabel = (m: number) => {
  const h = Math.floor(m / 60) % 24, mm = m % 60;
  const ap = h >= 12 ? 'pm' : 'am';
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}${mm ? ':' + String(mm).padStart(2, '0') : ''}${ap}`;
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  try {
    const { token } = await req.json().catch(() => ({}));
    if (!token || typeof token !== 'string') return json({ error: 'No token' }, 400);

    const svc = { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` };
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/bookings?guest_token=eq.${encodeURIComponent(token)}&select=status,on_date,start_min,end_min,note,guest_name,guest_email,booking_types(title,location,duration_min),provider:profiles!bookings_provider_id_fkey(full_name)`,
      { headers: svc },
    );
    const row = (r.ok ? await r.json() : [])?.[0];
    if (!row?.guest_email) return json({ ok: false }, 404);

    const t = row.booking_types ?? {};
    const provider = row.provider?.full_name ?? 'a Lichen member';
    const when = `${new Date(row.on_date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })} · ${minToLabel(row.start_min)} – ${minToLabel(row.end_min)} (${provider}'s local time)`;
    const link = `${APP_URL}/b/${token}`;

    const CONTENT: Record<string, { subject: string; lead: string }> = {
      pending: {
        subject: `Request received — ${t.title} with ${provider}`,
        lead: `${provider} confirms each request by hand. You'll get another email as soon as they answer.`,
      },
      confirmed: {
        subject: `You're booked — ${t.title} with ${provider}`,
        lead: `It's on ${provider}'s calendar. If anything changes, the link below is where you manage it.`,
      },
      declined: {
        subject: `${t.title} — that time didn't work`,
        lead: `${provider} couldn't take that slot. Their live availability is always at the link below — pick another whenever you like.`,
      },
      cancelled: {
        subject: `${t.title} on ${new Date(row.on_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} was cancelled`,
        lead: `This booking has been cancelled. Their live availability is at the link below if you'd like another time.`,
      },
    };
    const c = CONTENT[row.status];
    if (!c) return json({ ok: false, error: 'Unmailable status' }, 400);

    const text = `${c.lead}\n\n${t.title} — ${when}${t.location ? `\n${t.location}` : ''}\n\n${link}`;
    const html = `
<div style="background:#f3efe9;padding:32px 16px;font-family:Archivo,Helvetica,Arial,sans-serif;color:#2b2b28">
  <div style="max-width:520px;margin:0 auto">
    <p style="font-size:15px;line-height:1.6">${esc(c.lead)}</p>
    <div style="background:#fff;border:1px solid #e6e1d8;border-radius:14px;padding:18px 20px;margin:18px 0">
      <p style="margin:0;font-size:16px;font-weight:600">${esc(t.title ?? 'A session')}</p>
      <p style="margin:6px 0 0;font-size:14px">${esc(when)}</p>
      ${t.location ? `<p style="margin:6px 0 0;font-size:14px;color:#6b6b66">${esc(t.location)}</p>` : ''}
    </div>
    <p style="margin:22px 0"><a href="${link}" style="background:#e8956b;color:#fff;text-decoration:none;padding:12px 22px;border-radius:999px;font-size:14px">See your booking</a></p>
    <p style="font-size:12px;color:#8a8a84">No account needed — that link is yours to view or cancel the booking.</p>
  </div>
</div>`;

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: FROM, to: [row.guest_email], reply_to: REPLY_TO,
        subject: c.subject, text, html,
        headers: { 'List-Unsubscribe': `<mailto:${REPLY_TO}?subject=unsubscribe>` },
      }),
    });
    if (!res.ok) return json({ error: 'Email provider rejected the send.' }, 502);
    return json({ ok: true });
  } catch (e) {
    console.error('send-booking-mail:', e);
    return json({ error: 'Something went wrong.' }, 500);
  }
});
