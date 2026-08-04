// Real <head> for public pages (founder 2026-07-28; handle URLs 2026-08-03).
//
// Lichen is a client-side app, so a shared link to /spaces/<id> arrives with
// no title, no description and no image — invisible to Google and blank in a
// text message. This function serves the SAME index.html with real meta tags
// injected for public spaces and opted-in people. Everything else about the
// app is untouched: React still boots and takes over.
//
// Runs on Vercel's Node runtime. Only PUBLIC rows are ever read (the anon key
// plus the public-pages RLS policies decide that, not this code).

export const config = { runtime: 'nodejs' };

const SUPABASE_URL = 'https://mjqnaevertyzgjlpwynr.supabase.co';
const ANON = 'sb_publishable_pw5ENFOu9gJSXmULI3BW1A_hcUs-xO6';
const SITE = 'https://lichen.health';

// Vanity handles (lichen.health/<handle>) share the top-level path with every
// static app route (lichen.health/market, /home, /about…) — SpaceByHandle
// resolves the ambiguity client-side by placing /:handle last so static
// routes always win. This function has no route table to check against, so
// it skips the handle lookup for these names outright rather than risk a
// space or profile's meta tags showing up on the wrong page.
const RESERVED = new Set([
  'home', 'concierge', 'caregiver', 'directory', 'chat', 'calendar', 'saved',
  'assistant', 'mission', 'vision', 'ourstory', 'social-networks',
  'care-model', 'safety', 'platform', 'conscious-economy', 'business',
  'opportunity', 'pilot', 'blog', 'resources', 'organize', 'maps', 'profile',
  'invite', 'help', 'membership', 'compose', 'search', 'login',
  'reset-password', 'signup', 'onboarding', 'privacy', 'terms', 'mycelium',
  'bookings', 'communities', 'community', 'groups', 'market', 'donate',
  'giving', 'organizations', 'places', 'work', 'art', 'food', 'travel',
  'events', 'about', 'courses', 'library', 'members', 'spaces', 'welcome',
  'api', 'assets', 'icons', 'manifest', 'sw', 'robots', 'favicon', 'e',
]);

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

async function fetchRow(kind: 'spaces' | 'profiles', column: 'id' | 'handle', value: string) {
  const cols = kind === 'spaces'
    ? 'name,kind,description,avatar_url,location,contact'
    : 'full_name,headline,bio,avatar_url,identity_tags,contact';
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/${kind}?${column}=eq.${encodeURIComponent(value)}&select=${cols}`,
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
  const hm = !m && url.pathname.match(/^\/([a-z0-9-]+)\/?$/);
  let title = 'Lichen — a community that heals, grows and creates a better future, together';
  let desc = 'A member-run network for care, work, offerings, events, places, and a fairer economy.';
  let image = `${SITE}/icons/icon-512.png`;

  let row: Record<string, unknown> | null = null;
  if (m) {
    row = await fetchRow(m[1] === 'spaces' ? 'spaces' : 'profiles', 'id', m[2]);
  } else if (hm && !RESERVED.has(hm[1])) {
    row = await fetchRow('spaces', 'handle', hm[1]) ?? await fetchRow('profiles', 'handle', hm[1]);
  }

  if (row) {
    const name = (row.name ?? row.full_name) as string | null;
    if (name) {
      const kindWord = row.kind
        ? (row.kind as string).charAt(0).toUpperCase() + (row.kind as string).slice(1)
        : ((row.headline as string | null) ?? '');
      title = `${name}${kindWord ? ` — ${kindWord}` : ''} · Lichen`;
      const body = ((row.description ?? row.bio ?? '') as string).replace(/\s+/g, ' ').trim();
      const where = row.location ? ` · ${row.location}` : '';
      desc = (body ? body.slice(0, 180) : `${name} on Lichen`) + where;
      if (row.avatar_url) image = row.avatar_url as string;
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
