// THE FRIENDLY ADDRESS STAYS (founder 2026-11-06: "have all links on the
// platform keep their friendly addresses"): /market/<handle> renders the
// Marketplace scoped to that host IN PLACE, so the real URL carries a handle,
// not ?member=<uuid>. Sections inside read a synthetic location; chrome that
// lives OUTSIDE that render (the TopBar's scope badge) reads this store —
// the topIdentity/topBack pattern: the route publishes, cleanup owned by it.
import { useEffect, useSyncExternalStore } from 'react';

export type VanityScope = { key: 'space' | 'member'; id: string } | null;

let current: VanityScope = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

export function useVanityScope(): VanityScope {
  return useSyncExternalStore(
    (f) => { subs.add(f); return () => { subs.delete(f); }; },
    () => current,
  );
}

/** The vanity route announces whose section is standing while mounted. */
export function useVanityScopeFor(scope: VanityScope) {
  const key = scope ? `${scope.key}:${scope.id}` : '';
  useEffect(() => {
    if (!scope) return;
    current = scope; emit();
    return () => { if (current && `${current.key}:${current.id}` === key) { current = null; emit(); } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}
