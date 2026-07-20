// Supabase Edge Function: send-cal-steps
//
// Emails the signed-in member the calendar-import steps. Why: on phones,
// Google hijacks calendar.google.com links into its app — which doesn't
// contain the secret iCal address at all (web-only). So the app offers
// "email me the steps" and the checklist waits in their inbox for the next
// time they're at a computer. Requires RESEND_API_KEY.

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const FROM = Deno.env.get('INVITE_SENDER_FROM') ?? 'Lichen <hello@lichen.healthcare>';
const APP_URL = (Deno.env.get('APP_URL') ?? 'https://lichen.healthcare').replace(/\/$/, '');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const TEXT = `Connect your calendar to Lichen — 2 minutes at a computer

Lichen reads only busy times from your calendar, so booking and event
planning can see when you're genuinely free. Other members never see event
details. Do this once at a computer (Google only shows the address on the web):

GOOGLE CALENDAR
1. On a computer, open calendar.google.com and sign in.
2. Click the gear (top right) → Settings.
3. In the left list, click your calendar's name.
4. Scroll to "Integrate calendar".
5. Copy the "Secret address in iCal format" (starts with https://…/private-…/basic.ics).
6. In Lichen: Calendar → gear → Other calendars → paste → Add.

APPLE / iCLOUD — easiest right on your iPhone
1. Open the Calendar app → Calendars (bottom).
2. Tap the ⓘ beside your iCloud calendar → turn on "Public Calendar".
3. Share Link → Copy, then paste it into Lichen (starts with webcal:// — paste as-is).
(On a computer: icloud.com → Calendar → share icon → Public Calendar.)

OUTLOOK (computer — publishing lives in the web version, not the phone app)
1. At outlook.com → gear → Calendar → Shared calendars.
2. Publish your calendar ("Can view all details") and copy the ICS link.

Treat the address like a password — anyone holding it can read your
calendar. Lichen never displays it again after you add it.

Prefer pictures? Lichen's calendar settings carry an illustrated
step-by-step guide: ${APP_URL}/calendar/settings

— Lichen`;

function html(): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const steps = esc(TEXT).replace(/\n/g, '<br/>');
  return `<!doctype html><html><body style="margin:0;background:#f3efe9;font-family:Archivo,Helvetica,Arial,sans-serif;color:#2b2b28">
  <div style="max-width:560px;margin:0 auto;padding:32px 24px">
    <p style="font-size:22px;font-weight:600;margin:0 0 16px">Lichen</p>
    <p style="font-size:14px;line-height:1.7;margin:0 0 24px">${steps}</p>
    <p style="margin:0 0 28px">
      <a href="${APP_URL}/calendar/settings" style="display:inline-block;background:#e8956b;color:#fff;text-decoration:none;padding:12px 22px;border-radius:999px;font-weight:600">Open Lichen calendar settings</a>
    </p>
  </div></body></html>`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!RESEND_API_KEY) return json({ error: 'Email is not configured yet.' }, 500);

  const auth = req.headers.get('Authorization') ?? '';
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: auth },
  });
  if (!userRes.ok) return json({ error: 'Not signed in.' }, 401);
  const user = await userRes.json();
  const email = user?.email as string | undefined;
  if (!email) return json({ error: 'No email on your account.' }, 400);

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: FROM, to: [email],
      subject: 'Connect your calendar to Lichen — steps for when you’re at a computer',
      text: TEXT, html: html(),
    }),
  });
  if (!res.ok) return json({ error: 'Email provider rejected the send.', detail: await res.text() }, 502);
  return json({ ok: true, to: email });
});
