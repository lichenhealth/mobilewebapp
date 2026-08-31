// READING A BUSINESS'S COLOUR OFF ITS LOGO — one implementation.
//
// This lived inside the brand-colors function, reachable only from the page
// builder's "✦ My branding" button. So the assistant could SET a page's
// colours but had no way to see the logo, and answered a steward asking to
// "switch to Countryman Stables branding" by asking her for a hex code
// (founder 2026-08-28). The prompt and the parsing now live here, and both
// the function and the assistant's tool call this — a second copy would drift
// the day someone tuned one of them.

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


export type BrandScheme = { accent: string | null; ground: string };

/** Ask what colour a logo says a business is, and which ground it belongs on.
 *  `null` accent means the logo is black and white. Never throws — a colour
 *  suggestion is never worth failing someone's request over. */
export async function readBrandScheme(
  imageUrl: string, apiKey: string, model = 'claude-haiku-4-5-20251001',
): Promise<BrandScheme | null> {
  if (!apiKey || !imageUrl) return null;
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model, max_tokens: 16,
        messages: [{ role: 'user', content: [
          { type: 'image', source: { type: 'url', url: imageUrl } },
          { type: 'text', text: PROMPT },
        ] }],
      }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d?.error?.message ?? `Anthropic ${r.status}`);
    const text: string = d?.content?.[0]?.text ?? '';
    const hexes = text.match(/#[0-9a-fA-F]{6}\b/g) ?? [];
    const accent: string | null = hexes[0]?.toLowerCase() ?? null;
    const groundHex: string | null = hexes[1]?.toLowerCase() ?? null;
    const word = text.match(/\b(white|warm)\b/i);
    let ground = groundHex ?? (word ? word[1].toLowerCase() : 'white');
    if (/^#[0-9a-f]{6}$/i.test(ground)) {
      const [r2, g2, b2] = [1, 3, 5].map((i) => parseInt(ground.slice(i, i + 2), 16));
      if (0.2126 * r2 + 0.7152 * g2 + 0.0722 * b2 < 200) ground = 'white';
    }
    return { accent, ground };
  } catch (err) {
    console.error('readBrandScheme:', err);
    return null;
  }
}
