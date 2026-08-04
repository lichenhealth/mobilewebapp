// Real <head> for public pages (founder 2026-07-28).
//
// Lichen is a client-side app, so a shared link to /spaces/<id> arrives with
// no title, no description and no image — invisible to Google and blank in a
// text message. This function serves the SAME index.html with real meta tags
// injected for public spaces and opted-in people. Everything else about the
// app is untouched: React still boots and takes over.
//
// Runs on Vercel's Edge runtime — the handler uses the Web Fetch
// Request/Response signature, which is the Edge convention (config was
// wrongly set to 'nodejs' before 2026-08-03, which crashed every invocation
// with FUNCTION_INVOCATION_FAILED — this feature had never actually worked).
// Only PUBLIC rows are ever read (the anon key plus the public-pages RLS
// policies decide that, not this code).

export const config = { runtime: 'edge' };

const SUPABASE_URL = 'https://mjqnaevertyzgjlpwynr.supabase.co';
const ANON = 'sb_publishable_pw5ENFOu9gJSXmULI3BW1A_hcUs-xO6';
const SITE = 'https://lichen.health';

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

async function fetchRow(kind: 'spaces' | 'profiles', id: string) {
  const cols = kind === 'spaces'
    ? 'name,kind,description,avatar_url,location,contact'
    : 'full_name,headline,bio,avatar_url,identity_tags,contact';
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/${kind}?id=eq.${encodeURIComponent(id)}&select=${cols}`,
    { headers: { apikey: ANON, Authorization: `Bearer ${ANON}` } },
  );
  if (!r.ok) return null;
  const rows = await r.json();
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const shell = await fetch(`${SITE}/index.html`).then((r) => r.text()).catch(() => '');
  if (!shell) return new Response('', { status: 302, headers: { Location: url.pathname } });

  const m = url.pathname.match(/^\/(spaces|members)\/([^/?#]+)/);
  let title = 'Lichen — a community that heals, grows and creates a better future, together';
  let desc = 'A member-run network for care, work, offerings, events, places, and a fairer economy.';
  let image = `${SITE}/icons/icon-512.png`;

  if (m) {
    const row = await fetchRow(m[1] === 'spaces' ? 'spaces' : 'profiles', m[2]);
    if (row) {
      const name = row.name ?? row.full_name;
      if (name) {
        const kindWord = row.kind
          ? row.kind.charAt(0).toUpperCase() + row.kind.slice(1)
          : (row.headline ?? '');
        title = `${name}${kindWord ? ` — ${kindWord}` : ''} · Lichen`;
        const body = (row.description ?? row.bio ?? '').replace(/\s+/g, ' ').trim();
        const where = row.location ? ` · ${row.location}` : '';
        desc = (body ? body.slice(0, 180) : `${name} on Lichen`) + where;
        if (row.avatar_url) image = row.avatar_url;
      }
    }
  }

  const tags = [
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(desc)}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:title" content="${esc(title)}" />`,
    `<meta property="og:description" content="${esc(desc)}" />`,
    `<meta property="og:image" content="${esc(image)}" />`,
    `<meta property="og:url" content="${esc(SITE + url.pathname)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<link rel="canonical" href="${esc(SITE + url.pathname)}" />`,
  ].join('\n    ');

  // Replace the shell's own <title>, then inject ours.
  const html = shell
    .replace(/<title>[\s\S]*?<\/title>/i, '')
    .replace('</head>', `    ${tags}\n  </head>`);

  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=0, s-maxage=300, stale-while-revalidate=86400',
    },
  });
}
