// Supabase Edge Function: link-preview
//
// Fetches a URL server-side and returns Open Graph / basic metadata so the
// care-post composer can attach a rich preview card. Called via
// supabase.functions.invoke('link-preview', { body: { url } }) at COMPOSE time;
// the resolved metadata is stored on the post, so viewers never re-fetch.
//
// No secrets required. JWT verification stays ON (only logged-in caregivers
// compose). On any failure it returns a minimal { url } so the composer can
// still fall back to a plain clickable link.

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });

const decode = (s: string) =>
  s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&#x27;/gi, "'")
    .replace(/&nbsp;/g, ' ')
    .trim();

/** Pull a <meta property/name="key" content="…"> value (either attribute order). */
function meta(html: string, key: string): string | undefined {
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]*content=["']([^"']*)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${key}["']`, 'i'),
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]) return decode(m[1]);
  }
  return undefined;
}

function absolute(image: string | undefined, base: string): string | undefined {
  if (!image) return undefined;
  try {
    return new URL(image, base).toString();
  } catch {
    return image;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  let url = '';
  try {
    url = String((await req.json())?.url ?? '').trim();
  } catch {
    return json({ error: 'Invalid request body.' }, 400);
  }
  if (!/^https?:\/\//i.test(url)) return json({ error: 'A valid http(s) URL is required.' }, 400);

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: {
        // Some sites gate OG tags behind a browser-y UA.
        'User-Agent': 'Mozilla/5.0 (compatible; LichenLinkPreview/1.0; +https://lichen.healthcare)',
        Accept: 'text/html,application/xhtml+xml',
      },
    });
    clearTimeout(timer);

    const type = res.headers.get('content-type') ?? '';
    if (!res.ok || !type.includes('text/html')) return json({ url });

    // Only need the <head>; cap the body so we don't slurp huge pages.
    const html = (await res.text()).slice(0, 250_000);
    const title =
      meta(html, 'og:title') ??
      meta(html, 'twitter:title') ??
      decode((html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? '')) ||
      undefined;
    const description = meta(html, 'og:description') ?? meta(html, 'twitter:description') ?? meta(html, 'description');
    const image = absolute(meta(html, 'og:image') ?? meta(html, 'twitter:image'), res.url || url);
    const siteName = meta(html, 'og:site_name') ?? new URL(res.url || url).hostname.replace(/^www\./, '');

    return json({ url, title, description, image, siteName });
  } catch {
    return json({ url });
  }
});
