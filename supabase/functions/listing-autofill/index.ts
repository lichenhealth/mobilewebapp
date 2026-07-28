// Supabase Edge Function: listing-autofill
//
// The mockup's "AI" toggle (Figma 286-4961, founder 2026-07-28): a member
// writes their listing in plain words and Claude suggests the structured
// details — category tags (ONLY from the ids the client sends, i.e. the real
// taxonomy), condition, and trade tags. Suggestions land as pre-checked
// chips the member can uncheck; publishing never depends on this call.
//
// Auth: verify_jwt (members only). Raw fetch to api.anthropic.com (repo
// convention). Secrets: ANTHROPIC_API_KEY (already set).
// Model override: AUTOFILL_MODEL (default haiku — pennies per call).

const KEY = (Deno.env.get('ANTHROPIC_API_KEY') ?? '').replace(/[^\x21-\x7E]/g, '');
const MODEL = Deno.env.get('AUTOFILL_MODEL') ?? 'claude-haiku-4-5-20251001';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const CONDITIONS = ['new', 'like_new', 'good', 'fair'];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!KEY) return json({});   // unconfigured → quiet no-op

  let body: { title?: string; text?: string; categories?: { id: string; name: string }[] };
  try { body = await req.json(); } catch { return json({ error: 'Invalid body' }, 400); }
  const title = (body.title ?? '').slice(0, 200);
  const text = (body.text ?? '').slice(0, 2000);
  const cats = (Array.isArray(body.categories) ? body.categories : [])
    .filter((c) => c && typeof c.id === 'string' && typeof c.name === 'string')
    .slice(0, 120);
  if (!title && !text) return json({});

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
        max_tokens: 300,
        messages: [{
          role: 'user',
          content:
            'A member of a community marketplace wrote this listing:\n\n' +
            `TITLE: ${title}\nBODY: ${text}\n\n` +
            'Available category tags (id — name):\n' +
            cats.map((c) => `${c.id} — ${c.name}`).join('\n') +
            '\n\nSuggest structured details as JSON with exactly these keys:\n' +
            '{"categories": [up to 3 category IDS from the list above that clearly fit],\n' +
            ` "condition": [subset of ${JSON.stringify(CONDITIONS)} — the item's condition if stated or clearly implied; for an in-search-of post, the range they would accept; empty if not a physical item or unknowable],\n` +
            ' "tradeTags": [short phrases of what they OFFER in trade, only if the text names them]}\n\n' +
            'Be conservative — an empty array beats a guess. Reply with the JSON object and nothing else.',
        }],
      }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d?.error?.message ?? `Anthropic ${r.status}`);
    const out: string = d?.content?.[0]?.text ?? '{}';
    const m = out.match(/\{[\s\S]*\}/);
    const raw = m ? JSON.parse(m[0]) as Record<string, unknown> : {};
    // Belt and braces: only real ids / vocabulary survive.
    const catIds = new Set(cats.map((c) => c.id));
    const categories = (Array.isArray(raw.categories) ? raw.categories : [])
      .filter((x): x is string => typeof x === 'string' && catIds.has(x)).slice(0, 3);
    const condition = (Array.isArray(raw.condition) ? raw.condition : [])
      .filter((x): x is string => typeof x === 'string' && CONDITIONS.includes(x));
    const tradeTags = (Array.isArray(raw.tradeTags) ? raw.tradeTags : [])
      .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
      .map((x) => x.trim().slice(0, 40)).slice(0, 5);
    return json({ categories, condition, tradeTags });
  } catch (err) {
    console.error('listing-autofill error:', err);
    return json({});   // honest degrade — the member just fills it by hand
  }
});
