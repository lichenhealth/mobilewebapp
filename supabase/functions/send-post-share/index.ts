// Supabase Edge Function: send-post-share
//
// PRIVATE LISTING LINKS + GUEST CHECKOUT mail (founder 2026-11-06: "if
// someone off lichen is on the list, it allows them to see the marketplace
// listing… they shouldn't have to join lichen to engage in the specific
// piece of content").
//
// Two modes, both DERIVED FROM THE ROW — nothing a caller types reaches an
// inbox but the seller's own choice of recipient:
//   {guest_id}  — the seller emails a guest the listing card + their private
//                 /p/<token> link. The caller must be the post's host
//                 (post_host — the author, or a steward of the space it
//                 speaks for), verified against the auth server.
//   {order_id}  — a status mail to the order's BUYER: asked / accepted (pay
//                 link) / declined / paid receipt. Content comes from the
//                 order's current state, so re-sending only re-tells the
//                 truth (the send-booking-mail posture). Called by the client
//                 after a seller's answer and by stripe-webhook after payment.
//
// verify_jwt = false (the webhook calls the order mode server-to-server).
// Env: RESEND_API_KEY (+ optional NOTIF_FROM, INVITE_REPLY_TO, APP_URL).

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const FROM = Deno.env.get('NOTIF_FROM') ?? 'Lichen <hello@lichen.health>';
const REPLY_TO = Deno.env.get('INVITE_REPLY_TO') ?? 'connect@lichen.health';
const APP_URL = (Deno.env.get('APP_URL') ?? 'https://lichen.health').replace(/\/$/, '');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const sb = (path: string, init?: RequestInit) =>
  fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
const one = async (path: string) => {
  const r = await sb(path);
  const d = await r.json().catch(() => null);
  return Array.isArray(d) ? d[0] ?? null : null;
};

const dollars = (cents: number) => {
  const v = cents / 100;
  return '$' + (Number.isInteger(v) ? String(v) : v.toFixed(2));
};

// deno-lint-ignore no-explicit-any
function firstPhoto(p: any): string | null {
  const media: { type?: string; url?: string }[] = Array.isArray(p?.details?.media) ? p.details.media : [];
  return media.find((m) => m?.type === 'photo' && m?.url)?.url ?? p?.image_url ?? null;
}
// deno-lint-ignore no-explicit-any
const postTitle = (p: any) => (p?.title?.trim() || String(p?.body ?? '').trim().slice(0, 60) || 'A listing');

// deno-lint-ignore no-explicit-any
async function sellerName(p: any): Promise<string> {
  if (p.author_space_id) {
    const s = await one(`spaces?id=eq.${p.author_space_id}&select=name`);
    if (s?.name) return s.name;
  }
  const pr = await one(`profiles?id=eq.${p.author_id}&select=full_name`);
  return pr?.full_name ?? 'A Lichen member';
}

/** The listing card — the event invitation's anatomy (photo crown, serif
 *  title, peach button, per-send stamp so Gmail never folds the tail). */
function card(o: { eyebrow: string; title: string; price: string; seller: string; body: string;
  link: string; cta: string; photo: string | null; fine: string }): string {
  const stamp = new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/Denver' });
  return `<!doctype html><html><body style="margin:0;background:#f3efe9;font-family:Archivo,Helvetica,Arial,sans-serif;color:#2b2b28">
  <div style="max-width:520px;margin:0 auto;padding:32px 24px">
    <p style="font-size:22px;font-weight:600;margin:0 0 14px">Lichen</p>
    <div style="background:#fff;border:1px solid #e6e1d8;border-radius:18px;overflow:hidden;margin:0 0 22px;box-shadow:0 10px 30px rgba(42,51,56,0.08)">
      ${o.photo ? `<img src="${esc(o.photo)}" alt="" width="520" style="display:block;width:100%;max-height:300px;object-fit:cover">` : ''}
      <div style="padding:26px 24px 22px;text-align:center">
        <p style="font-family:'Iowan Old Style',Georgia,'Times New Roman',serif;font-size:12px;letter-spacing:0.12em;text-transform:uppercase;color:#c06b3e;margin:0 0 10px">${esc(o.eyebrow)}</p>
        <p style="font-family:'Iowan Old Style',Georgia,'Times New Roman',serif;font-size:26px;font-weight:400;line-height:1.2;margin:0 0 10px">${esc(o.title)}</p>
        ${o.price ? `<p style="font-size:16px;font-weight:600;margin:0 0 8px">${esc(o.price)}</p>` : ''}
        ${o.body ? `<p style="font-size:14px;color:#5a554c;line-height:1.5;margin:0 0 8px">${o.body}</p>` : ''}
        <p style="font-size:14px;color:#5a554c;margin:12px 0 18px">From <strong>${esc(o.seller)}</strong></p>
        <a href="${o.link}" style="display:inline-block;background:#e8956b;color:#fff;text-decoration:none;padding:12px 24px;border-radius:999px;font-weight:600">${esc(o.cta)}</a>
      </div>
    </div>
    <p style="font-size:13px;color:#8a857c;line-height:1.5;margin:0 0 6px">${o.fine}</p>
    <p style="font-size:11px;color:#b5b0a6;margin:10px 0 0">Sent ${esc(stamp)} MT</p>
  </div></body></html>`;
}

async function send(to: string, subject: string, html: string, text: string) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: [to], reply_to: REPLY_TO, subject, html, text }),
  });
  if (!r.ok) throw new Error(`Resend ${r.status}: ${await r.text()}`);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!RESEND_API_KEY || !SUPABASE_URL || !SERVICE_KEY) return json({ error: 'Not configured' }, 500);

  let body: { guest_id?: string; order_id?: string };
  try { body = await req.json(); } catch { return json({ error: 'Invalid body' }, 400); }
  const uuid = /^[0-9a-f-]{36}$/i;

  // ── the seller shares the listing with a guest ─────────────────────────
  if (body.guest_id) {
    if (!uuid.test(body.guest_id)) return json({ error: 'Bad id' }, 400);
    const ures = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: ANON_KEY || SERVICE_KEY, Authorization: req.headers.get('Authorization') ?? '' },
    });
    const uid = ures.ok ? (await ures.json().catch(() => null))?.id : null;
    if (!uid) return json({ error: 'Sign in to share a listing' }, 401);

    const g = await one(`post_guests?id=eq.${body.guest_id}&select=id,post_id,name,email,token`);
    if (!g) return json({ error: 'No such guest' }, 404);
    if (!g.email) return json({ error: 'This guest has no email — text them instead' }, 400);
    const hostRes = await sb('rpc/post_host', { method: 'POST', body: JSON.stringify({ p_post: g.post_id, p_uid: uid }) });
    if ((await hostRes.json().catch(() => false)) !== true) return json({ error: 'Only the seller can share this listing' }, 403);

    const p = await one(`posts?id=eq.${g.post_id}&select=id,title,body,details,image_url,author_id,author_space_id`);
    if (!p) return json({ error: 'No such listing' }, 404);
    const seller = await sellerName(p);
    const link = `${APP_URL}/p/${g.token}`;
    const price = typeof p.details?.price === 'string' ? p.details.price : '';
    const snippet = String(p.body ?? '').trim().slice(0, 220);
    const first = (g.name ?? '').trim().split(/\s+/)[0];
    const html = card({
      eyebrow: 'Shared with you', title: postTitle(p), price, seller,
      body: esc(snippet) + (String(p.body ?? '').length > 220 ? '…' : ''),
      link, cta: 'See it', photo: firstPhoto(p),
      fine: `${first ? esc(first) + ', ' : ''}${esc(seller)} shared this with you on Lichen — a community marketplace. You don't need an account to look${price ? ' or to buy it by card' : ''}. This link is just for you.`,
    });
    const text = `${seller} shared "${postTitle(p)}" with you on Lichen.\n${price ? price + '\n' : ''}\nSee it: ${link}\n\nYou don't need an account to look${price ? ' or to buy it by card' : ''}. This link is just for you.`;
    try {
      await send(g.email, `${seller} shared “${postTitle(p)}” with you`, html, text);
      await sb(`post_guests?id=eq.${g.id}`, { method: 'PATCH', body: JSON.stringify({ emailed_at: new Date().toISOString() }) });
      return json({ ok: true });
    } catch (e) { console.error('share send:', e); return json({ error: 'The email didn’t go out — try again' }, 502); }
  }

  // ── a status mail to the buyer, derived from the order ─────────────────
  if (body.order_id) {
    if (!uuid.test(body.order_id)) return json({ error: 'Bad id' }, 400);
    const o = await one(`post_orders?id=eq.${body.order_id}&select=id,post_id,guest_id,buyer_name,buyer_email,price_cents,status,paid_at,payment_pending_at`);
    if (!o) return json({ error: 'No such order' }, 404);
    if (!o.buyer_email) return json({ ok: true, skipped: 'no email' });
    const g = o.guest_id ? await one(`post_guests?id=eq.${o.guest_id}&select=token`) : null;
    const p = await one(`posts?id=eq.${o.post_id}&select=id,title,body,details,image_url,author_id,author_space_id`);
    if (!p || !g?.token) return json({ ok: true, skipped: 'no listing' });
    const seller = await sellerName(p);
    const link = `${APP_URL}/p/${g.token}`;
    const amt = dollars(o.price_cents);
    const title = postTitle(p);
    let subject = '', eyebrow = '', cta = 'See your order', fine = '', lead = '';
    if (o.paid_at) {
      subject = `Paid ✓ — ${title}`; eyebrow = 'Payment received';
      lead = `You paid ${amt}. ${esc(seller)} has been told — they'll be in touch to arrange the hand-off.`;
      fine = `Keep this as your receipt. Questions? Reply to this email.`;
    } else if (o.status === 'accepted') {
      subject = `${seller} said yes — ${title}`; eyebrow = 'Ready to pay'; cta = `Pay ${amt}`;
      lead = `${esc(seller)} accepted your request. Pay ${amt} by card whenever you're ready.`;
      fine = `Payment runs through Lichen's Stripe checkout. Nothing was charged until now.`;
    } else if (o.status === 'declined') {
      subject = `About your request — ${title}`; eyebrow = 'Not this time';
      lead = `${esc(seller)} couldn't take this one. Nothing was charged.`;
      cta = 'See the listing'; fine = 'You can still reply to this email if you have questions.';
    } else if (o.status === 'requested') {
      subject = `Request sent — ${title}`; eyebrow = 'Request sent';
      lead = `We told ${esc(seller)} you'd like to buy this for ${amt}. Once they say yes, you'll get a link to pay by card.`;
      fine = 'Nothing is charged until the seller confirms.';
    } else {
      return json({ ok: true, skipped: o.status });
    }
    const html = card({
      eyebrow, title, price: amt, seller, body: lead, link, cta, photo: firstPhoto(p), fine,
    });
    const text = `${subject}\n\n${lead.replace(/<[^>]+>/g, '')}\n\n${link}`;
    try { await send(o.buyer_email, subject, html, text); return json({ ok: true }); }
    catch (e) { console.error('order mail:', e); return json({ error: 'Mail failed' }, 502); }
  }

  return json({ error: 'Nothing to send' }, 400);
});
