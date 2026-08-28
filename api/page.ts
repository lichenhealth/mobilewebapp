// Real <head> for public pages (founder 2026-07-28).
//
// Lichen is a client-side app, so a shared link to /spaces/<id> arrives with
// no title, no description and no image — invisible to Google and blank in a
// text message. This function serves the SAME index.html with real meta tags
// injected for public spaces and opted-in people — by id (/spaces/:id,
// /members/:id), by handle (/countrymanstables) and on a space's own custom
// domain (founder 2026-08-28). Everything else about the
// app is untouched: React still boots and takes over.
//
// Runs on Vercel's Edge runtime — the handler uses the Web Fetch
// Request/Response signature, which is the Edge convention (config was
// wrongly set to 'nodejs' before 2026-08-03, which crashed every invocation
// with FUNCTION_INVOCATION_FAILED — this feature had never actually worked).
// Only PUBLIC rows are ever read (the anon key plus the public-pages RLS
// policies decide that, not this code).

import { spaceHandleForHost } from '../src/lib/customDomain';

export const config = { runtime: 'edge' };

const SUPABASE_URL = 'https://mjqnaevertyzgjlpwynr.supabase.co';
const ANON = 'sb_publishable_pw5ENFOu9gJSXmULI3BW1A_hcUs-xO6';
const SITE = 'https://lichen.health';

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

async function fetchRow(kind: 'spaces' | 'profiles', by: 'id' | 'handle', value: string) {
  const cols = kind === 'spaces'
    ? 'name,kind,description,avatar_url,location,contact,page'
    : 'full_name,headline,bio,avatar_url,identity_tags,contact,page';
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/${kind}?${by}=eq.${encodeURIComponent(value)}&select=${cols}`,
    { headers: { apikey: ANON, Authorization: `Bearer ${ANON}` } },
  );
  if (!r.ok) return null;
  const rows = await r.json();
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);

  // FETCH THE SHELL FROM THIS DEPLOYMENT, NOT FROM PRODUCTION (founder
  // 2026-08-28). The shell names a hash-versioned bundle — index-<hash>.js —
  // so production's shell on a preview deployment points at a bundle that
  // deployment doesn't have: the script 404s and the page renders BLANK.
  // Invisible before now because only /spaces/:id and /members/:id reached
  // this function and nobody opened one on a preview; it also meant a brand
  // new production deployment could serve the previous build's shell for the
  // seconds before the alias moved.
  let shell = await fetch(`${url.origin}/index.html`).then((r) => (r.ok ? r.text() : '')).catch(() => '');
  if (!shell && url.origin !== SITE) {
    shell = await fetch(`${SITE}/index.html`).then((r) => (r.ok ? r.text() : '')).catch(() => '');
  }
  // Was a 302 back to the same path — which this function serves, so a failed
  // shell fetch redirected to itself forever. Fail honestly instead.
  if (!shell) return new Response('Temporarily unavailable', { status: 503, headers: { 'Retry-After': '30' } });

  // WHOSE SITE IS THIS (founder 2026-08-28): on a custom domain every path
  // serves that space's website, so the HOST names the page, not the path —
  // and og:url/canonical have to point at the barn's own address. Sending
  // them to lichen.health would tell Google the barn's site is a copy of a
  // page that lives somewhere else.
  const host = (req.headers.get('host') ?? '').toLowerCase();
  const customHandle = spaceHandleForHost(host);
  const origin = customHandle ? `https://${host}` : SITE;
  const canonicalPath = customHandle ? '/' : url.pathname;

  let title = 'Lichen — a community that heals, grows and creates a better future, together';
  let desc = 'A member-run network for care, work, offerings, events, places, and a fairer economy.';
  let image = `${SITE}/icons/icon-512.png`;
  let noindex = false;

  // Three ways a page names itself:
  //   custom domain             → the space that host belongs to
  //   /spaces/:id, /members/:id → a shared id link (the 2026-07-28 original)
  //   /:handle                  → the clean address members are actually
  //                               given ("lichen.health/<handle>"), which
  //                               until now got no meta at all
  // Handles resolve spaces before people — the same order SpaceByHandle.tsx
  // uses — so the meta always describes the page React goes on to render
  // (founder 2026-08-28).
  const byId = url.pathname.match(/^\/(spaces|members)\/([^/?#]+)/);
  const byHandle = url.pathname.match(/^\/([A-Za-z0-9][A-Za-z0-9_-]*)\/?$/);
  let row: Record<string, unknown> | null = null;
  if (customHandle) {
    row = await fetchRow('spaces', 'handle', customHandle);
  } else if (byId) {
    row = await fetchRow(byId[1] === 'spaces' ? 'spaces' : 'profiles', 'id', byId[2]);
  } else if (byHandle) {
    const h = byHandle[1].toLowerCase();
    row = (await fetchRow('spaces', 'handle', h)) ?? (await fetchRow('profiles', 'handle', h));
  }

  // An address that resolves to nothing still renders "Nothing lives at that
  // address" — a soft 404. Handing it a canonical URL invites Google to index
  // it, so unmatched addresses are noindexed instead (founder 2026-08-28).
  if (!row) noindex = true;

  if (row) {
    const r = row as Record<string, string | null | undefined> & { page?: { noindex?: boolean } };
    const name = r.name ?? r.full_name;
    if (name) {
      const where = r.location ? ` · ${r.location}` : '';
      if (customHandle) {
        // The barn's own domain is the barn's own site: the title is just
        // the business. No "· Lichen" suffix, no kind label, and no location
        // either — `location` holds a full street address, which reads as
        // noise in a tab and in search results.
        title = name;
      } else {
        const kindWord = r.kind
          ? r.kind.charAt(0).toUpperCase() + r.kind.slice(1)
          : (r.headline ?? '');
        title = `${name}${kindWord ? ` — ${kindWord}` : ''} · Lichen`;
      }
      const body = (r.description ?? r.bio ?? '').replace(/\s+/g, ' ').trim();
      desc = (body ? body.slice(0, 180) : `${name} on Lichen`) + where;
      if (r.avatar_url) image = r.avatar_url;
    }
    noindex = !!(r.page && r.page.noindex);
  }

  const tags = [
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(desc)}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:title" content="${esc(title)}" />`,
    `<meta property="og:description" content="${esc(desc)}" />`,
    `<meta property="og:image" content="${esc(image)}" />`,
    `<meta property="og:url" content="${esc(origin + canonicalPath)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    // A published-but-unlisted page (page.noindex): served to anyone with
    // the link, but crawlers asked to leave it alone (founder 2026-08-20).
    ...(noindex ? ['<meta name="robots" content="noindex" />'] : []),
    `<link rel="canonical" href="${esc(origin + canonicalPath)}" />`,
  ].join('\n    ');

  // Replace the shell's own <title>, then inject ours.
  // Strip what we're about to replace. The shell carries its own description
  // and og tags; injecting ours on top left every patched page with TWO
  // <meta name="description">, and a crawler picks whichever it likes
  // (founder 2026-08-28).
  const html = shell
    .replace(/<title>[\s\S]*?<\/title>/i, '')
    .replace(/[ \t]*<meta\s+name="description"[^>]*>\n?/gi, '')
    .replace(/[ \t]*<meta\s+property="og:[^"]*"[^>]*>\n?/gi, '')
    .replace(/[ \t]*<meta\s+name="twitter:[^"]*"[^>]*>\n?/gi, '')
    .replace(/[ \t]*<link\s+rel="canonical"[^>]*>\n?/gi, '')
    .replace('</head>', `    ${tags}\n  </head>`);

  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=0, s-maxage=300, stale-while-revalidate=86400',
    },
  });
}
