// Single source of truth for mapping a route → a notification "scope".
// Every notification is scoped to a top-level `section` OR a specific `space`.
// Home is the GLOBAL view (total across everything).

export type Section =
  | 'concierge' | 'chat' | 'calendar' | 'saved' | 'maps'
  | 'profile' | 'mycelium' | 'communities' | 'groups' | 'market'
  | 'invite' | 'membership';

export type Scope =
  | { kind: 'global' }
  | { kind: 'section'; section: Section }
  | { kind: 'space'; spaceId: string };

// Ordered; first prefix match wins (mirrors TopBar's SECTION_LOGOS ordering).
const PREFIX_SECTIONS: { prefix: string; section: Section }[] = [
  { prefix: '/concierge', section: 'concierge' },
  { prefix: '/chat', section: 'chat' },
  { prefix: '/calendar', section: 'calendar' },
  { prefix: '/saved', section: 'saved' },
  { prefix: '/maps', section: 'maps' },
  { prefix: '/profile', section: 'profile' },
  { prefix: '/mycelium', section: 'mycelium' },
  { prefix: '/communities', section: 'communities' },
  { prefix: '/groups', section: 'groups' },
  { prefix: '/market', section: 'market' },
  { prefix: '/invite', section: 'invite' },
  { prefix: '/membership', section: 'membership' },
];

/** Resolve the notification scope for the current path. Home → global; a single
 *  community/group → that space; otherwise the matching top-level section. */
export function scopeForPath(pathname: string): Scope {
  if (pathname === '/' || pathname.startsWith('/home')) return { kind: 'global' };
  const space = pathname.match(/^\/(?:communities|groups)\/([^/]+)$/);
  if (space) return { kind: 'space', spaceId: space[1] };
  const hit = PREFIX_SECTIONS.find((p) => pathname.startsWith(p.prefix));
  return hit ? { kind: 'section', section: hit.section } : { kind: 'global' };
}

/** Section for a nav item's route (for per-item badges). Home returns null —
 *  it uses the global total instead. */
export function sectionForRoute(to: string): Section | null {
  if (to === '/home' || to === '/') return null;
  return PREFIX_SECTIONS.find((p) => to.startsWith(p.prefix))?.section ?? null;
}
