import { useEffect, useSyncExternalStore } from 'react';

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

// ONE WAY TO DO IT (founder 2026-08-28: "this issue has happened multiple
// times, so can we make sure there isn't a leaky fix"). Three rounds of
// acting-as/identity bugs have all been the same shape: a screen whose
// SUBJECT is one entity, not wearing that entity's mark, because setting and
// clearing were hand-written per screen and a screen was missed. This hook is
// the only correct way to write it — pass the subject or null, cleanup is
// not yours to forget.
//
// ⚠ THE RULE, so the next screen does not leak: a screen wears an entity's
// mark when that entity is what the screen is ABOUT and what it writes to —
// its profile, its build thread, its room. NOT when a screen merely lists or
// mentions entities (Directory, Map, Compose, Invite): those are Lichen's own
// screens and wear Lichen's mark. If you are unsure, ask whether an edit made
// on this screen lands on that entity. If yes, it wears their mark.
//
// ⚠ This is the CENTRE mark only — whose screen this is. It is a different
// question from the top-right chip, which says who you are ACTING as, and the
// two are allowed to disagree: stewarding Countryman Stables as yourself is
// the normal case, not a bug.
export function useTopIdentityFor(subject: TopIdentity) {
  const id = subject?.id ?? null;
  const name = subject?.name ?? null;
  const avatarUrl = subject?.avatarUrl ?? null;
  const kind = subject?.kind ?? null;
  useEffect(() => {
    if (!id || !name || !kind) return;
    setTopIdentity({ id, name, avatarUrl, kind });
    return () => setTopIdentity(null);
  }, [id, name, avatarUrl, kind]);
}
