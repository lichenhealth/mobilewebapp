// CUSTOM DOMAINS (founder 2026-07-29): a domain that belongs to a space
// serves that space's public page directly — countrymanstables.com IS the
// barn's website, not a redirect. The map is deliberately hardcoded for now
// (one barn); when more members bring domains this becomes a spaces.domain
// column + a Vercel Domains API integration (the premium tier).
const HOST_SPACES: Record<string, string> = {
  'countrymanstables.com': 'countrymanstables',
  'www.countrymanstables.com': 'countrymanstables',
  'countrymanstables.org': 'countrymanstables',
  'www.countrymanstables.org': 'countrymanstables',
};

/** The space handle this hostname serves, or null on Lichen's own domains. */
export function hostSpaceHandle(): string | null {
  return HOST_SPACES[window.location.hostname] ?? null;
}

/** App links from a custom domain must cross back to Lichen's own origin —
 *  auth, gate and OAuth are configured for lichen.healthcare, and the barn's
 *  visitors shouldn't wander the app on the barn's address. */
export function appUrl(path: string): string {
  return hostSpaceHandle() ? `https://lichen.healthcare${path}` : path;
}
