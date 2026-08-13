// Supabase Edge Function: profile-snapshot
//
// SNAPSHOT (founder 2026-08-11): "Share with me everything about who you are
// and what you do, and I'll translate that into a Public Web & Lichen App
// Profile." A member talks, types, or pastes the address of whatever they
// already have — a one-page Squarespace, a Wix site, an Etsy storefront —
// and Claude proposes the whole presence: tagline, story, offerings mapped
// onto Lichen's REAL category vocabulary, contact details, hours, listings.
//
// This is a SNAPSHOT, not a sync: one read, no credentials, nothing ongoing.
// (Sync — Lichen as hub or spoke, with live inventory — is its own later
// build; see the Sync & Manage door.)
//
// Nothing here writes anything. It returns a PROPOSAL; the member confirms
// or edits every field on the review screen before a single row is touched.
// Everything it produces is public-facing, which is exactly why.
//
// Auth: verify_jwt (members only). Raw fetch to api.anthropic.com (repo
// convention). Secrets: ANTHROPIC_API_KEY. Model override: SNAPSHOT_MODEL.

const KEY = (Deno.env.get('ANTHROPIC_API_KEY') ?? '').replace(/[^\x21-\x7E]/g, '');
const MODEL = Deno.env.get('SNAPSHOT_MODEL') ?? 'claude-sonnet-5';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

/** Strip a fetched page to readable text — no parser, just enough to read. */
function textFromHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

/** One fetch per URL, size- and time-capped. A page that won't load is
 *  reported back rather than failing the whole run. */
async function readUrl(raw: string): Promise<{ url: string; text: string; ok: boolean }> {
  const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 12000);
    const r = await fetch(url, {
      signal: ctl.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'LichenSnapshot/1.0 (+https://lichen.health)' },
    });
    clearTimeout(t);
    if (!r.ok) return { url, text: '', ok: false };
    const type = r.headers.get('content-type') ?? '';
    if (!/text\/html|text\/plain|application\/xhtml/i.test(type)) return { url, text: '', ok: false };
    const html = (await r.text()).slice(0, 300_000);
    return { url, text: textFromHtml(html).slice(0, 12_000), ok: true };
  } catch {
    return { url, text: '', ok: false };
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!KEY) return json({ error: 'The assistant is not configured yet.' }, 503);

  let body: {
    text?: string;
    urls?: string[];
    kind?: 'person' | 'space';
    entityName?: string;
    categories?: { id: string; name: string; domain: string }[];
  };
  try { body = await req.json(); } catch { return json({ error: 'Invalid body' }, 400); }

  const text = (body.text ?? '').slice(0, 20_000);
  const urls = (Array.isArray(body.urls) ? body.urls : [])
    .filter((u) => typeof u === 'string' && u.trim().length > 3).slice(0, 4);
  const cats = (Array.isArray(body.categories) ? body.categories : [])
    .filter((c) => c && typeof c.id === 'string' && typeof c.name === 'string')
    .slice(0, 200);
  const entityName = (body.entityName ?? '').slice(0, 120);
  const isSpace = body.kind === 'space';
  if (!text.trim() && urls.length === 0) return json({ error: 'Tell me something to work from first.' }, 400);

  // HOME SUMMARY (founder 2026-08-11): read the WHOLE story and write a
  // fresh welcome for the front page — not the first inches of it. Its own
  // small mode on this function, sharing the auth, key and model.
  if ((body as { mode?: string }).mode === 'summary') {
    const story = text.trim();
    if (!story) return json({ error: 'Write your story first and I’ll summarize it.' }, 400);
    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 400,
          messages: [{
            role: 'user',
            content:
              'This is the full story from a Lichen page' + (entityName ? ` for "${entityName}"` : '') + ':\n\n' +
              story +
              '\n\nWrite the WELCOME for their homepage: one or two short paragraphs that greet a visitor ' +
              'and make them want to read more. Draw on the WHOLE story — the things worth knowing first ' +
              'may be anywhere in it, not just the opening. Keep their voice. Invent nothing. Do not ' +
              'summarize mechanically ("This barn offers…") — write it the way they would greet someone ' +
              'at the gate. Reply with the welcome text and nothing else.',
          }],
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error?.message ?? `Anthropic ${r.status}`);
      const blocks = (Array.isArray(d?.content) ? d.content : []) as { type?: string; text?: string }[];
      const out = blocks.filter((b) => b?.type === 'text' && typeof b.text === 'string')
        .map((b) => b.text).join('\n').trim();
      if (!out) throw new Error('empty');
      return json({ summary: out.slice(0, 1200) });
    } catch (err) {
      console.error('profile-snapshot summary:', err);
      return json({ error: 'That didn’t come back cleanly. Try again in a moment.' }, 502);
    }
  }

  const read = await Promise.all(urls.map(readUrl));
  const unreadable = read.filter((r) => !r.ok).map((r) => r.url);
  const pages = read.filter((r) => r.ok);
  if (!text.trim() && pages.length === 0) {
    return json({ error: 'I couldn’t read those links. Paste what you’d like me to know instead.' }, 422);
  }

  const catLines = cats.map((c) => `${c.id} — ${c.name} [${c.domain}]`).join('\n');

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
        max_tokens: 2400,
        messages: [{
          role: 'user',
          content:
            `You are helping ${isSpace ? 'an organization' : 'a person'}` +
            (entityName ? ` called "${entityName}"` : '') +
            ' set up their presence on Lichen — a community platform where their page is both a public website and their profile inside the app.\n\n' +
            'They told you this about themselves:\n---\n' +
            (text.trim() || '(nothing written — work from their website below)') +
            '\n---\n' +
            (pages.length
              ? '\nAnd here is the text of the website(s) they pointed you at:\n' +
                pages.map((p) => `\n=== ${p.url} ===\n${p.text}`).join('\n')
              : '') +
            '\n\nLichen\'s real category vocabulary (id — name [domain]):\n' + catLines +
            '\n\nPropose their presence as JSON with exactly these keys:\n' +
            '{\n' +
            '  "tagline": "one line, under 90 chars — what they do and for whom",\n' +
            '  "story": "2-4 short paragraphs in THEIR voice, warm and plain, separated by blank lines. Write it the way they\'d tell a neighbour. Never invent facts, awards, dates or credentials they did not give you.",\n' +
            '  "categories": [category IDS from the list above that genuinely fit what they offer — up to 12],\n' +
            '  "contact": {"email": "", "phone": "", "website": "", "booking": "", "address": "", "hours": "", "instagram": "", "facebook": ""},\n' +
            '  "listings": [up to 6 things they offer: {"title": "", "body": "1-2 sentences", "domain": "good" | "service", "price": "as they state it, else empty"}],\n' +
            '  "missing": ["short plain-language questions for anything important you could not find — e.g. \'What are your hours?\'"]\n' +
            '}\n\n' +
            'Rules: only fill a contact field if the value actually appears in what they gave you — never guess an address or invent an email. Only use category IDs from the list. Leave a field empty rather than filling it with a plausible invention. Reply with the JSON object and nothing else.',
        }],
      }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d?.error?.message ?? `Anthropic ${r.status}`);
    // Take EVERY text block, not just the first — a reply can lead with a
    // non-text block, and content[0].text is then undefined (which silently
    // produced an empty proposal).
    const blocks = (Array.isArray(d?.content) ? d.content : []) as { type?: string; text?: string }[];
    const out: string = blocks
      .filter((b) => b?.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text).join('\n') || '{}';
    const m = out.match(/\{[\s\S]*\}/);
    const raw = m ? JSON.parse(m[0]) as Record<string, unknown> : {};

    // Belt and braces: only real category ids survive, and every string is
    // capped — a proposal is shown to a human, not trusted.
    const byId = new Map(cats.map((c) => [c.id, c]));
    const categories = (Array.isArray(raw.categories) ? raw.categories : [])
      .filter((x): x is string => typeof x === 'string' && byId.has(x)).slice(0, 12);
    const str = (v: unknown, cap: number) => (typeof v === 'string' ? v.trim().slice(0, cap) : '');
    const rawContact = (raw.contact ?? {}) as Record<string, unknown>;
    const contact: Record<string, string> = {};
    (['email', 'phone', 'website', 'booking', 'address', 'hours', 'instagram', 'facebook'] as const)
      .forEach((k) => { const v = str(rawContact[k], 300); if (v) contact[k] = v; });
    const listings = (Array.isArray(raw.listings) ? raw.listings : [])
      .map((l) => {
        const o = (l ?? {}) as Record<string, unknown>;
        return {
          title: str(o.title, 140),
          body: str(o.body, 600),
          domain: o.domain === 'good' ? 'good' : 'service',
          price: str(o.price, 60),
        };
      })
      .filter((l) => l.title).slice(0, 6);
    const missing = (Array.isArray(raw.missing) ? raw.missing : [])
      .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
      .map((x) => x.trim().slice(0, 160)).slice(0, 6);

    return json({
      tagline: str(raw.tagline, 200),
      story: str(raw.story, 6000),
      categories,
      categoryNames: categories.map((id) => byId.get(id)!.name),
      contact,
      listings,
      missing,
      read: pages.map((p) => p.url),
      unreadable,
    });
  } catch (err) {
    console.error('profile-snapshot error:', err);
    return json({ error: 'That didn’t come back cleanly. Try again in a moment.' }, 502);
  }
});
