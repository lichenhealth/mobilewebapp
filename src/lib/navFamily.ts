/** THE NAV-FAMILY MAP (founder 2026-10-21, from /organize wearing no back
 *  arrow and no lit DRIVE tab: "can we systemically build these nav rules in
 *  for drive and all other platforms"): every screen belongs to ONE nav
 *  family — the bottom-nav / side-rail root that lights while you stand on
 *  it, and (where `mark` says so) the TopBar section whose logo + back arrow
 *  it wears. A section's own subtree is covered by plain prefix matching
 *  (/chat/:id under /chat); THIS map covers screens whose ADDRESS lives
 *  outside their family. When a new route belongs to a section but doesn't
 *  share its prefix, add it HERE — never a bespoke regex inside a nav
 *  component (that's how /organize sat unlit for three months).
 *
 *  `mark: false` exists for a screen that lights its family in the nav but
 *  keeps its OWN back affordance — /docs/:id's ← names a destination (its
 *  room's drive) that history-back can't promise, and giving it the TopBar
 *  arrow too would be the one-back mistake. */
const OFF_PREFIX: { re: RegExp; family: string; mark: boolean }[] = [
  { re: /^\/organize/, family: '/drive', mark: true },
  { re: /^\/chat\/[^/]+\/drive/, family: '/drive', mark: true },
  { re: /^\/spaces\/[^/]+\/drive/, family: '/drive', mark: true },
  { re: /^\/docs\/[^/]+/, family: '/drive', mark: false },
  { re: /^\/saved/, family: '/drive', mark: false }, // alias; TopBar's own /saved prefix row carries the mark
];

/** The nav root that lights for this path, or null = let prefixes decide.
 *  When non-null it is the WHOLE answer: the nav lights the family and
 *  stands every prefix match down (so Chat doesn't stay lit on a room's
 *  drive just because the address starts /chat). */
export function navFamily(pathname: string): string | null {
  return OFF_PREFIX.find((r) => r.re.test(pathname))?.family ?? null;
}

/** The TopBar section this path dresses as (logo + back arrow), or null =
 *  the ordinary prefix scan. */
export function markFamily(pathname: string): string | null {
  const hit = OFF_PREFIX.find((r) => r.re.test(pathname));
  return hit && hit.mark ? hit.family : null;
}
