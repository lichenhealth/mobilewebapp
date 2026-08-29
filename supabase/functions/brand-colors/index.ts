// Supabase Edge Function: brand-colors
//
// "A smart way for the website to re-do the public facing page with their
// color scheme" (founder 2026-08-28). Countryman Stables' logo is a dark red
// wordmark; the page was wearing Lichen's peach. The colours a business
// already owns are sitting in the file they uploaded — so read them.
//
// Returns an accent hex and which of three named grounds the logo sits best
// on — a scheme, not a palette. Still no more than that: the page has one
// accent slot and three possible grounds, so anything richer would invite a
// UI asking an owner to assign colours to things.
//
// The whole answer is a PROPOSAL the owner previews and accepts or refuses
// (founder 2026-08-28: "let them preview it to decide if they like it"), and
// the client re-checks contrast and will deepen the accent — this function
// is a suggestion, never an authority.
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
  'This is a business\'s logo. Answer two things about it.\n\n' +
  'ACCENT: the one colour that most reads as THEIR colour — the hue someone would name ' +
  'if asked what colour this business is. Prefer a saturated brand colour over black, ' +
  'white or grey; those are almost always the ink and the paper, not the brand. If the ' +
  'logo is genuinely only black and white, use NONE.\n\n' +
  'GROUND: the page background this logo belongs on. Answer "white" unless a soft tint ' +
  'would genuinely suit it better — a barely-there wash of the brand hue, or a warm ' +
  'paper tone for something traditional. If you choose a tint, give it as a hex and keep ' +
  'it VERY light: near-white, the sort of colour that reads as paper rather than as a ' +
  'colour. Never a dark or saturated background — the page carries long text and a logo ' +
  'that may be drawn in dark ink.\n\n' +
  'Reply with exactly this and nothing else: a hex colour or NONE, a space, then "white" ' +
  'or a hex. For example: #A32B2B #FBF7F4\n' +
  'Another example: #1D6F52 white';

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
    // Accent first, ground second — a reply may carry two hexes.
    const hexes = text.match(/#[0-9a-fA-F]{6}\b/g) ?? [];
    const accentHex: string | null = hexes[0] ?? null;
    const groundHex: string | null = hexes[1] ?? null;
    const groundWord = text.match(/\b(white|warm)\b/i);
    let ground = groundHex ?? (groundWord ? groundWord[1].toLowerCase() : 'white');
    // Refuse a ground too dark to carry text, whatever was asked for — the
    // client derives ink from it, but a dark page is not on offer.
    const g = /^#[0-9a-f]{6}$/i.test(ground) ? ground : null;
    if (g) {
      const [r, gg, b] = [1, 3, 5].map((i) => parseInt(g.slice(i, i + 2), 16));
      if (0.2126 * r + 0.7152 * gg + 0.0722 * b < 200) ground = 'white';
    }
    // A ground is still worth returning when the logo has no colour of its
    // own — a black-and-white wordmark on white paper is a scheme too.
    return json({ accent: accentHex ? accentHex.toLowerCase() : null, ground });
  } catch (err) {
    console.error('brand-colors error:', err);
    return json({});   // honest degrade — the page keeps the colours it has
  }
});
