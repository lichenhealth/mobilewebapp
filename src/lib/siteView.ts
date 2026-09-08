/** THE ONE DECISION FOR "SHOW THE NAKED SITE" (founder 2026-09-09: the
 *  builder's Preview opened with the side nav and the app's bone ground —
 *  "This bug has shown up before, can we audit the platform and de-bug this
 *  issue?"). It had, three times, and always with the same shape: five
 *  surfaces are supposed to render a page as the OPEN WEB sees it —
 *
 *    · a signed-out visitor (and every custom-domain visitor)
 *    · ?preview=1 — the owner's Public View / the builders' ↗ Preview
 *    · ?embed=1  — the page pane beside a build conversation
 *    · ?brand / ?ground — the colour trials
 *
 *  — and each surface hand-assembled its own flags, so every new flag missed
 *  one of them (the beige sides 08-28, the embed pane's toggle 08-31, the
 *  preview's side nav 09-09). This helper is the choke point: App.tsx stands
 *  the chrome down on it, and the page routes derive the template's
 *  `signedIn` from it, so a rendering can never again be half-naked.
 *
 *  What "naked" means, in layers (all keyed on this one answer):
 *   · App chrome stands down — TopBar, BottomNav, SideMenu, gutter padding.
 *   · The template renders as a GUEST sees it (`signedIn=false`), which in
 *    turn fires `body.is-website` (shell + ground shed) and hides every
 *    member-only signal (presence line, website line, in-app doors).
 *  The ADMIN | LICHEN VIEW | PUBLIC VIEW toggle and the grab-pen are page-
 *  level owner affordances and deliberately survive on ?preview=1 — they are
 *  the way out and the feedback pen, not app chrome. */
export function nakedSiteView(search: string): boolean {
  const p = new URLSearchParams(search);
  return p.get('preview') === '1' || p.get('embed') === '1' || p.has('brand') || p.has('ground');
}
