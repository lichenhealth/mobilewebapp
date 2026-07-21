// Supabase Edge Function: style-tags
//
// Stage 1 of visual style (founder, 2026-07-21: "visual learning tools that
// help people identify if the table matches their aesthetic"). Looks at a
// marketplace listing photo with Claude vision and returns a handful of tags
// from a CONTROLLED vocabulary — deterministic words the matcher and search
// can compare, and members can browse by. Compose calls this fire-and-forget
// after publishing; failure never blocks a post.
//
// Auth: verify_jwt (members only). Images must live in OUR storage — the
// function refuses to fetch arbitrary URLs. Raw fetch to api.anthropic.com
// (repo convention). Secrets: ANTHROPIC_API_KEY (already set).

const KEY = (Deno.env.get('ANTHROPIC_API_KEY') ?? '').replace(/[^\x21-\x7E]/g, '');
const MODEL = Deno.env.get('STYLE_TAGS_MODEL') ?? 'claude-haiku-4-5-20251001';
const SUPABASE_URL = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/$/, '');

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

// The whole style language — matching stays deterministic because tags can
// only come from this list.
const VOCABULARY = [
  // material
  'solid wood', 'metal', 'ceramic', 'textile', 'glass', 'leather', 'stone', 'wicker', 'paper',
  // palette
  'warm tones', 'cool tones', 'earth tones', 'colorful', 'neutral', 'dark', 'light',
  // style
  'rustic', 'modern', 'minimalist', 'mid-century', 'bohemian', 'farmhouse', 'industrial',
  'vintage', 'handmade', 'ornate', 'scandinavian', 'southwestern', 'art deco', 'cottage',
  'natural', 'playful', 'elegant',
  // form
  'curved', 'angular', 'delicate', 'sturdy', 'small', 'large',
];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!KEY) return json({ tags: [] });   // unconfigured → quiet no-op

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
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 150,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'url', url: image } },
            { type: 'text', text:
              'Describe this marketplace listing photo by choosing 3 to 5 tags, ONLY from this list:\n' +
              VOCABULARY.join(', ') +
              '\n\nReply with a JSON array of the chosen tags and nothing else.' },
          ],
        }],
      }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d?.error?.message ?? `Anthropic ${r.status}`);
    const text: string = d?.content?.[0]?.text ?? '[]';
    const m = text.match(/\[[\s\S]*?\]/);
    const raw = m ? JSON.parse(m[0]) as unknown[] : [];
    // Belt and braces: only vocabulary words survive.
    const tags = raw.filter((t): t is string => typeof t === 'string')
      .map((t) => t.toLowerCase().trim())
      .filter((t) => VOCABULARY.includes(t))
      .slice(0, 5);
    return json({ tags });
  } catch (err) {
    console.error('style-tags error:', err);
    return json({ tags: [] });   // honest degrade — a post never fails over tags
  }
});
