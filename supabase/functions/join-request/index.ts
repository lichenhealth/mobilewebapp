// Supabase Edge Function: join-request — the knock on Lichen's door.
//
// Invite-only signups (founder 2026-07-28): walk-ins aren't walled out, they
// introduce themselves. This records the knock (service role — the table has
// no client INSERT) and emails the founder with reply-to set to the asker,
// so the 1:1 conversation is one "Reply" away. Admins also get a bell.
// verify_jwt = false — the asker has no account yet, that's the whole point.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const FROM = Deno.env.get('INVITE_SENDER_FROM') ?? 'Lichen <hello@lichen.healthcare>';
const FOUNDER_INBOX = Deno.env.get('JOIN_REQUEST_INBOX') ?? 'connect@lichen.health';
const db = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  { auth: { persistSession: false } },
);

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  let body: { name?: string; email?: string; story?: string; website?: string };
  try { body = await req.json(); } catch { return json({ error: 'Invalid body' }, 400); }
  if (body.website) return json({ ok: true });   // honeypot field — bots fill it, humans never see it
  const name = (body.name ?? '').trim().slice(0, 120);
  const email = (body.email ?? '').trim().slice(0, 200);
  const story = (body.story ?? '').trim().slice(0, 2000);
  if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return json({ error: 'A name and a real email are needed.' }, 400);
  }

  // One open knock per email — repeats just re-affirm, quietly.
  const { data: existing } = await db.from('join_requests')
    .select('id').eq('email', email).eq('status', 'new').maybeSingle();
  if (existing) return json({ ok: true });

  const { error: insErr } = await db.from('join_requests').insert({ name, email, story: story || null });
  if (insErr) { console.error('join_requests insert:', insErr.message); return json({ error: 'Something went wrong.' }, 500); }

  // Bell every platform admin.
  const { data: admins } = await db.from('profiles').select('id').eq('is_admin', true);
  for (const a of admins ?? []) {
    await db.from('notifications').insert({
      recipient_id: a.id, section: 'home', type: 'join_request_knock',
      title: `${name} asked to join Lichen`,
      body: (story || 'No note — just a knock.').slice(0, 140),
      link: '/invite?email=' + encodeURIComponent(email),
    });
  }

  // The founder's 1:1 door: an email whose Reply goes straight to the asker.
  if (RESEND_API_KEY) {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: FROM,
        to: FOUNDER_INBOX,
        reply_to: email,
        subject: `Knock: ${name} wants to join Lichen`,
        html: `<!doctype html><html><body style="margin:0;background:#f3efe9;font-family:Archivo,Helvetica,Arial,sans-serif;color:#2b2b28">
<div style="max-width:520px;margin:0 auto;padding:32px 24px">
  <p style="font-size:20px;font-weight:600;margin:0 0 14px">Someone's at the door</p>
  <p style="font-size:15px;line-height:1.6;margin:0 0 8px"><strong>${esc(name)}</strong> · ${esc(email)}</p>
  ${story ? `<p style="font-size:15px;line-height:1.6;margin:0 0 20px;padding:14px 16px;background:#fff;border-radius:12px;color:#4a463f">${esc(story)}</p>` : '<p style="font-size:14px;color:#8a857c;margin:0 0 20px">No note — just a knock.</p>'}
  <p style="font-size:14px;line-height:1.6;color:#4a463f;margin:0">Hit <strong>Reply</strong> to talk with them directly. If it feels like a fit, send them an invitation from the app's Invite page.</p>
</div></body></html>`,
      }),
    }).catch((e) => console.error('resend:', e));
  }

  return json({ ok: true });
});
