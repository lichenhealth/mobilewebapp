// Supabase Edge Function: twilio-inbound
//
// A MEMBER'S TWILIO NUMBER ANSWERS THROUGH LICHEN (founder 2026-11-24: "let's
// finish up the twilio port so i can cancel spruce"). wireNumber() points the
// number's VoiceUrl/SmsUrl here with ?p=<member>&k=<their key>.
//   step=voice  → ring the member's own cell (caller ID passed through) for
//                 20 seconds, then voicemail
//   step=after  → answered? hang up. Otherwise greeting + record (3 min,
//                 transcribed by Twilio)
//   step=done   → one bell: "New voicemail from …"
//   step=sms    → one bell: "Text from …" (short-code promos stay quiet)
// Nothing is stored here: the recording, transcript and texts live at Twilio
// and the Brain reads them live with the member's own keys.
//
// verify_jwt = false (Twilio calls it); the key in the URL is the gate.

import { inboundKey, inboundUrl } from '../_shared/twilio.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const svc = (path: string, init?: RequestInit) =>
  fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
const xml = (body: string) => new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`, { headers: { 'Content-Type': 'text/xml' } });
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const pretty = (n: string) => { const d = n.replace(/\D/g, ''); return d.length === 11 && d.startsWith('1') ? `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}` : n; };
const e164 = (raw: string) => { const d = raw.replace(/\D/g, ''); if (d.length === 10) return '+1' + d; if (d.length === 11 && d.startsWith('1')) return '+' + d; return raw.trim().startsWith('+') && d.length >= 8 ? '+' + d : null; };

async function bell(profile: string, type: string, title: string, body: string) {
  await svc('rpc/notify', { method: 'POST', body: JSON.stringify({ p_recipient: profile, p_section: 'chat', p_space: null, p_type: type, p_title: title.slice(0, 200), p_body: body.slice(0, 300), p_link: '/assistant?section=chat', p_actor: null }) });
}

Deno.serve(async (req) => {
  const u = new URL(req.url);
  const p = u.searchParams.get('p') ?? '';
  const k = u.searchParams.get('k') ?? '';
  const step = u.searchParams.get('step') ?? 'voice';
  if (!/^[0-9a-f-]{36}$/.test(p) || k !== await inboundKey(p)) return new Response('Not found', { status: 404 });
  const form = req.method === 'POST' ? new URLSearchParams(await req.text()) : u.searchParams;
  const from = form.get('From') ?? '';

  if (step === 'sms') {
    // Short-code senders (promos, codes) are 5–6 digits: no bell for those.
    if (from.replace(/\D/g, '').length >= 10) await bell(p, 'twilio_text', `Text from ${pretty(from)}`, 'On your Twilio number — ask your Brain to read it.');
    return xml('');
  }

  if (step === 'voice') {
    const r = await (await svc(`profiles?id=eq.${p}&select=phone,first_name,full_name`)).json();
    const me = Array.isArray(r) ? r[0] : null;
    const cell = me?.phone ? e164(String(me.phone)) : null;
    const to = form.get('To') ?? '';
    if (cell && cell !== e164(from) && cell !== e164(to)) {
      return xml(`<Dial timeout="20" answerOnBridge="true" callerId="${esc(from || to)}" action="${esc(await inboundUrl(p, 'after'))}" method="POST"><Number>${esc(cell)}</Number></Dial>`);
    }
    return xml(`<Redirect method="POST">${esc(await inboundUrl(p, 'after'))}</Redirect>`);
  }

  if (step === 'after') {
    if (form.get('DialCallStatus') === 'completed') return xml('<Hangup/>');
    const r = await (await svc(`profiles?id=eq.${p}&select=first_name,full_name`)).json();
    const name = String((Array.isArray(r) && (r[0]?.first_name || r[0]?.full_name)) || 'us');
    return xml(`<Say voice="Polly.Joanna">Hi, you've reached ${esc(name)}. Please leave a message after the tone.</Say><Record maxLength="180" playBeep="true" transcribe="true" action="${esc(await inboundUrl(p, 'done'))}" method="POST"/>`);
  }

  if (step === 'done') {
    const secs = Number(form.get('RecordingDuration') ?? 0);
    if (secs >= 2) await bell(p, 'twilio_voicemail', `New voicemail from ${pretty(from) || 'a caller'}`, `${secs} seconds — ask your Brain to play back what they said.`);
    return xml('<Hangup/>');
  }
  return xml('');
});
