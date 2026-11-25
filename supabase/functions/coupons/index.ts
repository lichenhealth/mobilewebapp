// Supabase Edge Function: coupons
//
// COUPONS (founder 2026-11-25: "take pics of things and organize them for me
// to coupons! And then when they expire, delete them").
//
// Two jobs:
//   scan  — (signed-in member) a photo of a coupon, flyer or receipt-back →
//           Claude vision reads every coupon on it and returns the fields
//           (merchant, offer, code, minimum spend, expiry, where it's valid,
//           the fine print). Nothing is saved here: the member reviews the
//           reading and saves it through their own session. The photo is
//           sent as base64 from the browser — it lives in their PRIVATE
//           drive bucket, so there is no public URL to hand the model.
//   purge — (pg_cron via tick_coupons, x-webhook-secret) removes the photo
//           files of coupons that expired, then clears the queue. Storage
//           objects can't be deleted from SQL.
//
// Raw fetch to api.anthropic.com (repo convention). Secrets: ANTHROPIC_API_KEY,
// PUSH_HOOK_SECRET, SUPABASE_SERVICE_ROLE_KEY. Model: COUPON_MODEL.

const KEY = (Deno.env.get('ANTHROPIC_API_KEY') ?? '').replace(/[^\x21-\x7E]/g, '');
const MODEL = Deno.env.get('COUPON_MODEL') ?? 'claude-sonnet-5-5';
const SUPABASE_URL = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/$/, '');
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const WEBHOOK_SECRET = Deno.env.get('PUSH_HOOK_SECRET');
const DAILY_CAP = Number(Deno.env.get('COUPON_SCAN_CAP') ?? '60');

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-webhook-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const svc = (path: string, init: RequestInit = {}) => fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
  ...init,
  headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
});

async function purge(): Promise<Response> {
  const rows = await (await svc('coupon_photo_purge?select=path&limit=500')).json();
  const paths = (Array.isArray(rows) ? rows : []).map((r: { path: string }) => r.path).filter(Boolean);
  if (!paths.length) return json({ ok: true, removed: 0 });
  // The batch endpoint is the one that works (supabase-js .remove()).
  const r = await fetch(`${SUPABASE_URL}/storage/v1/object/drive`, {
    method: 'DELETE',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefixes: paths }),
  });
  if (!r.ok) { console.error('coupon purge', r.status, await r.text()); return json({ ok: false }, 500); }
  await svc(`coupon_photo_purge?path=in.(${paths.map((p) => `"${p.replace(/"/g, '')}"`).join(',')})`, { method: 'DELETE' });
  return json({ ok: true, removed: paths.length });
}

// The answer's shape — a JSON-schema structured answer (the proofread fn's
// posture; forced tool calls aren't accepted by current models).
const COUPON_FIELDS = {
  merchant: { type: 'string', description: 'The store or brand that honours it, e.g. "Chewy".' },
  offer: { type: 'string', description: 'The deal in a short plain line, e.g. "$20 off your first order of $49+, plus free delivery".' },
  code: { type: 'string', description: 'The promo code exactly as printed, or "" if none (a barcode-only coupon).' },
  min_spend: { type: 'number', description: 'Minimum purchase in dollars, 0 if none.' },
  expires_on: { type: 'string', description: 'YYYY-MM-DD. A two-digit year like 12/31/26 means 2026. "" if no date is printed.' },
  where_valid: { type: 'string', enum: ['online', 'in_store', 'both', 'unknown'] },
  url: { type: 'string', description: 'The website to use it at as https://… (e.g. "Chewy.com" → https://www.chewy.com), or "".' },
  category: { type: 'string', description: 'One or two words: pets, groceries, restaurant, beauty, home, clothing, travel, health, kids, other.' },
  terms: { type: 'string', description: 'The fine print condensed to the conditions that matter (new customers only, one per household, exclusions), or "".' },
};
const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['coupons', 'note'],
  properties: {
    coupons: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, required: Object.keys(COUPON_FIELDS), properties: COUPON_FIELDS },
    },
    note: { type: 'string', description: 'Anything you could not read clearly (a blurry code, a cut-off date), or "".' },
  },
};

async function scan(req: Request): Promise<Response> {
  const auth = req.headers.get('authorization') ?? '';
  const who = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: ANON_KEY || SERVICE_KEY, Authorization: auth } });
  if (!who.ok) return json({ error: 'Sign in first.' }, 401);
  const me = (await who.json())?.id as string | undefined;
  if (!me) return json({ error: 'Sign in first.' }, 401);
  if (!KEY) return json({ error: 'Reading photos is not set up yet.' }, 503);

  let body: { image?: string; media_type?: string };
  try { body = await req.json(); } catch { return json({ error: 'Invalid body' }, 400); }
  const image = (body.image ?? '').replace(/^data:[^,]+,/, '');
  const mediaType = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(String(body.media_type)) ? String(body.media_type) : 'image/jpeg';
  if (!image || image.length > 7_000_000) return json({ error: 'That photo is too large — try again.' }, 400);

  const since = new Date(); since.setUTCHours(0, 0, 0, 0);
  const used = await svc(`assistant_queries?profile_id=eq.${me}&context=eq.coupon&created_at=gte.${since.toISOString()}&select=id`, { headers: { Prefer: 'count=exact', Range: '0-0' } });
  const count = Number((used.headers.get('content-range') ?? '').split('/')[1] ?? 0);
  if (count >= DAILY_CAP) return json({ error: 'That’s a lot of coupons for one day — the daily limit is a cost guardrail. Type it in, or try tomorrow.' }, 429);

  const today = new Date().toISOString().slice(0, 10);
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2000,
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: image } },
          { type: 'text', text: `Today is ${today}. Read every coupon or promo offer in this photo. Copy codes character for character (0 vs O, 1 vs I matter — say so in note if unsure). If there is no coupon at all, return an empty list.` },
        ],
      }],
    }),
  });
  const d = await r.json();
  if (!r.ok) { console.error('coupon scan', d?.error?.message ?? r.status); return json({ error: 'I couldn’t read that photo — try again, or type it in.' }, 502); }
  await svc('assistant_queries', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({
    profile_id: me, context: 'coupon', model: MODEL,
    input_tokens: d?.usage?.input_tokens ?? 0, output_tokens: d?.usage?.output_tokens ?? 0,
  }) }).catch(() => {});
  const text = ((d?.content ?? []) as { type: string; text?: string }[]).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('');
  let out: { coupons?: unknown[]; note?: string } = { coupons: [] };
  try { out = JSON.parse(text); } catch { /* an unreadable answer reads as no coupons */ }
  const clean = (Array.isArray(out.coupons) ? out.coupons : []).slice(0, 10).map((c: Record<string, unknown>) => ({
    merchant: String(c.merchant ?? '').trim().slice(0, 120),
    offer: String(c.offer ?? '').trim().slice(0, 240),
    code: String(c.code ?? '').trim().slice(0, 80) || null,
    min_spend: Number.isFinite(Number(c.min_spend)) && Number(c.min_spend) > 0 ? Number(c.min_spend) : null,
    expires_on: /^\d{4}-\d{2}-\d{2}$/.test(String(c.expires_on ?? '')) ? String(c.expires_on) : null,
    where_valid: ['online', 'in_store', 'both'].includes(String(c.where_valid)) ? String(c.where_valid) : null,
    url: /^https:\/\/\S+$/.test(String(c.url ?? '')) ? String(c.url).slice(0, 600) : null,
    category: String(c.category ?? '').trim().slice(0, 40) || null,
    terms: String(c.terms ?? '').trim().slice(0, 2000) || null,
  })).filter((c: { merchant: string; offer: string }) => c.merchant && c.offer);
  return json({ coupons: clean, note: typeof out.note === 'string' ? out.note.slice(0, 300) : '' });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (req.headers.get('x-webhook-secret')) {
    if (!WEBHOOK_SECRET || req.headers.get('x-webhook-secret') !== WEBHOOK_SECRET) return json({ error: 'Unauthorized' }, 401);
    return purge();
  }
  try { return await scan(req); }
  catch (e) { console.error('coupons', e); return json({ error: 'Something went wrong — try again.' }, 500); }
});
