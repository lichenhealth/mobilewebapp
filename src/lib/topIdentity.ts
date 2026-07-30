import { useSyncExternalStore } from 'react';

// DE-BRANDING (founder 2026-07-30): on an entity's profile — group, org,
// place, person — the top bar wears THEIR mark, not Lichen's. "Remove
// ourselves from the spotlight." Profile screens broadcast the identity
// they're showing; TopBar listens.

export type TopIdentity = {
  id: string;
  name: string;
  avatarUrl?: string | null;
  kind: 'space' | 'person';
} | null;

let current: TopIdentity = null;
const subs = new Set<() => void>();

export function setTopIdentity(v: TopIdentity) {
  current = v;
  subs.forEach((f) => f());
}

export function useTopIdentity(): TopIdentity {
  return useSyncExternalStore(
    (cb) => { subs.add(cb); return () => subs.delete(cb); },
    () => current,
  );
}
