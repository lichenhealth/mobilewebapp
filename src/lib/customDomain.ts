// CUSTOM DOMAINS (founder 2026-07-29): a domain that belongs to a space
// serves that space's public page directly — countrymanstables.com IS the
// barn's website, not a redirect. The map is deliberately hardcoded for now
// (one barn); when more members bring domains this becomes a spaces.domain
// column + a Vercel Domains API integration (the premium tier).
export const HOST_SPACES: Record<string, string> = {
  'countrymanstables.com': 'countrymanstables',
  'www.countrymanstables.com': 'countrymanstables',
  'countrymanstables.org': 'countrymanstables',
  'www.countrymanstables.org': 'countrymanstables',
};

/** The space handle a hostname serves, or null on Lichen's own domains.
 *  Pure and window-free on purpose: `api/page.ts` (Vercel Edge) imports this
 *  same function, so the meta tags a crawler sees and the page React renders
 *  can never disagree about whose website a host is (founder 2026-08-28). */
export function spaceHandleForHost(hostname: string): string | null {
  return HOST_SPACES[hostname.toLowerCase()] ?? null;
}

/** The space handle this hostname serves, or null on Lichen's own domains. */
export function hostSpaceHandle(): string | null {
  return spaceHandleForHost(window.location.hostname);
}

/** Lichen's canonical origin (the 2026-07-29 consolidation: the app lives on
 *  lichen.health; lichen.healthcare 301s here and keeps only the send-email
 *  MX). Everything that writes an absolute app link uses this. */
export const APP_ORIGIN = 'https://lichen.health';

/** App links from a custom domain must cross back to Lichen's own origin —
 *  auth, gate and OAuth are configured for it, and the barn's visitors
 *  shouldn't wander the app on the barn's address. */
export function appUrl(path: string): string {
  return hostSpaceHandle() ? `${APP_ORIGIN}${path}` : path;
}
