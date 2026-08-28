// Supabase Edge Function: brand-colors
//
// "A smart way for the website to re-do the public facing page with their
// color scheme" (founder 2026-08-28). Countryman Stables' logo is a dark red
// wordmark; the page was wearing Lichen's peach. The colours a business
// already owns are sitting in the file they uploaded — so read them.
//
// Returns ONE accent hex and nothing else. Not a palette: the page has
// exactly one accent slot, and a function that returned five colours would
// invite a UI that asks an owner to assign them. The ground is chosen from
// three presets on the client, never from here.
//
// The client re-checks contrast against the chosen ground and will darken
// what comes back — this function is a suggestion, not an authority.
//
// Auth: verify_jwt (members only). Images must live in OUR storage — the
// function refuses to fetch arbitrary URLs (same guard as style-tags and
// image-focus; an image URL is a fetch this server makes).
// Secrets: ANTHROPIC_API_KEY (already set). Model: BRAND_COLORS_MODEL.

const KEY = (Deno.env.get('ANTHROPIC_API_KEY') ?? '').replace(/[^\x21-\x7E]/g, '');
const MODEL = Deno.env.get('BRAND_COLORS_MODEL') ?? 'claude-haiku-4-5-20251001';
const SUPABASE_URL = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/$/, '');

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const PROMPT =
  'This is a business\'s logo. Pick the one colour that most reads as THEIR colour — ' +
  'the hue someone would name if asked what colour this business is.\n' +
  'Prefer a saturated brand colour over black, white or grey; those are almost always ' +
  'the ink and the paper, not the brand. If the logo is genuinely only black and white, ' +
  'reply NONE.\n' +
  'Reply with a single hex colour like #A32B2B and nothing else — no words, no explanation.';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!KEY) return json({});   // unconfigured → quiet no-op, page keeps its accent

  let body: { image?: string };
  try { body = await req.json(); } catch { return json({ error: 'Invalid body' }, 400); }
  const image = (body.image ?? '').trim();
  if (!image.startsWith(`${SUPABASE_URL}/storage/v1/object/public/`)) {
    return json({ error: 'Image must be a Lichen upload.' }, 400);
  }

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 16,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'url', url: image } },
            { type: 'text', text: PROMPT },
          ],
        }],
      }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d?.error?.message ?? `Anthropic ${r.status}`);
    const text: string = d?.content?.[0]?.text ?? '';
    const m = text.match(/#[0-9a-fA-F]{6}\b/);
    if (!m) return json({});   // NONE, or anything that isn't a colour
    return json({ accent: m[0].toLowerCase() });
  } catch (err) {
    console.error('brand-colors error:', err);
    return json({});   // honest degrade — the page keeps whatever accent it has
  }
});
