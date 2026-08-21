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

  let body: { name?: string; email?: string; story?: string; website?: string; space_id?: string };
  try { body = await req.json(); } catch { return json({ error: 'Invalid body' }, 400); }
  if (body.website) return json({ ok: true });   // honeypot field — bots fill it, humans never see it
  const name = (body.name ?? '').trim().slice(0, 120);
  const email = (body.email ?? '').trim().slice(0, 200);
  const story = (body.story ?? '').trim().slice(0, 2000);
  if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return json({ error: 'A name and a real email are needed.' }, 400);
  }

  // A knock AT A SPACE (founder 2026-08-17: public pages are gateways into
  // Lichen). Only a live space with a public page can be knocked on — anything
  // else is a forged id, and the knock quietly falls back to a plain one.
  let space: { id: string; name: string; kind: string } | null = null;
  const spaceId = typeof body.space_id === 'string' && /^[0-9a-f-]{36}$/.test(body.space_id) ? body.space_id : null;
  if (spaceId) {
    const { data: sp } = await db.from('spaces')
      .select('id, name, kind, public_page, status').eq('id', spaceId).maybeSingle();
    if (sp && sp.public_page && sp.status === 'live') space = { id: sp.id, name: sp.name, kind: sp.kind };
  }

  // An address the desk marked SPAM never re-enters the queue — and never
  // learns it was marked (founder 2026-08-21). Same shape as the honeypot:
  // a quiet ok, no row, no bells.
  const { data: burned } = await db.from('join_requests')
    .select('id').eq('email', email).eq('status', 'spam').limit(1).maybeSingle();
  if (burned) return json({ ok: true });

  // One open knock per email — repeats just re-affirm, quietly. (A knock at a
  // different door by the same person updates which door it was.)
  const { data: existing } = await db.from('join_requests')
    .select('id, space_id').eq('email', email).eq('status', 'new').maybeSingle();
  if (existing) {
    if (space && existing.space_id !== space.id) {
      await db.from('join_requests').update({ space_id: space.id }).eq('id', existing.id);
    } else {
      return json({ ok: true });
    }
  } else {
    const { error: insErr } = await db.from('join_requests')
      .insert({ name, email, story: story || null, space_id: space?.id ?? null });
    if (insErr) { console.error('join_requests insert:', insErr.message); return json({ error: 'Something went wrong.' }, 500); }
  }

  // Bell every platform admin — and, for a knock at a space, its stewards,
  // who can answer it themselves from the space's backstage.
  const { data: admins } = await db.from('profiles').select('id').eq('is_admin', true);
  const bells = new Map<string, { link: string; title: string }>();
  for (const a of admins ?? []) {
    bells.set(a.id, {
      link: '/invite?email=' + encodeURIComponent(email),
      title: space ? `${name} asked to join ${space.name}` : `${name} asked to join Lichen`,
    });
  }
  if (space) {
    const { data: stewards } = await db.from('space_members')
      .select('profile_id').eq('space_id', space.id).in('role', ['admin', 'super_admin']);
    for (const st of stewards ?? []) {
      bells.set(st.profile_id, {
        link: `/spaces/${space.id}?manage=1#waiting`,
        title: `${name} asked to join ${space.name}`,
      });
    }
  }
  for (const [recipient, b] of bells) {
    await db.from('notifications').insert({
      recipient_id: recipient, section: 'home', type: 'join_request_knock',
      title: b.title,
      body: (story || 'No note — just a knock.').slice(0, 140),
      link: b.link,
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
        subject: space ? `Knock: ${name} wants to join ${space.name}` : `Knock: ${name} wants to join Lichen`,
        html: `<!doctype html><html><body style="margin:0;background:#f3efe9;font-family:Archivo,Helvetica,Arial,sans-serif;color:#2b2b28">
<div style="max-width:520px;margin:0 auto;padding:32px 24px">
  <p style="font-size:20px;font-weight:600;margin:0 0 14px">Someone's at the door</p>
  <p style="font-size:15px;line-height:1.6;margin:0 0 8px"><strong>${esc(name)}</strong> · ${esc(email)}</p>
  ${space ? `<p style="font-size:14px;color:#4a463f;margin:0 0 8px">Knocked from <strong>${esc(space.name)}</strong>&rsquo;s public page — its stewards were told too, and can send the invitation themselves.</p>` : ''}
  ${story ? `<p style="font-size:15px;line-height:1.6;margin:0 0 20px;padding:14px 16px;background:#fff;border-radius:12px;color:#4a463f">${esc(story)}</p>` : '<p style="font-size:14px;color:#8a857c;margin:0 0 20px">No note — just a knock.</p>'}
  <p style="font-size:14px;line-height:1.6;color:#4a463f;margin:0">Hit <strong>Reply</strong> to talk with them directly. If it feels like a fit, send them an invitation from the app's Invite page.</p>
</div></body></html>`,
      }),
    }).catch((e) => console.error('resend:', e));
  }

  return json({ ok: true });
});
