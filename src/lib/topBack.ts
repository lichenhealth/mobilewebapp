import { useEffect, useRef, useSyncExternalStore } from 'react';

// THE BACK ARROW LIVES BESIDE THE HAMBURGER — EVERYWHERE (founder
// 2026-10-21, drawing an arrow from a course page's in-body ← up to the ☰:
// "didn't we decide to have it next to the hamburger menu overall as a rule
// for the entire platform?"). Section screens always had the TopBar's ←;
// non-section screens wore a PageHead circle down in the body. Now a screen
// with a PageHead BROADCASTS its back handler and the TopBar renders the
// arrow up top — same circle, same slot, named destinations kept. PageHead
// renders inline only when no TopBar is standing (guest pages, full-bleed
// screens). The topIdentity store's pattern: one way in, cleanup owned here.

type BackHandler = (() => void) | null;

let handler: BackHandler = null;
let topBarUp = false;
const subs = new Set<() => void>();
const ping = () => subs.forEach((f) => f());

export function setTopBack(h: BackHandler) { handler = h; ping(); }
export function setTopBarMounted(up: boolean) { topBarUp = up; ping(); }

const sub = (cb: () => void) => { subs.add(cb); return () => { subs.delete(cb); }; };

/** TopBar reads this: a page-registered back wins over the generic walk. */
export function useTopBack(): BackHandler {
  return useSyncExternalStore(sub, () => handler);
}

/** PageHead reads this: with a TopBar standing, the arrow renders up there. */
export function useTopBarMounted(): boolean {
  return useSyncExternalStore(sub, () => topBarUp);
}

/** The one way to broadcast a back handler. The latest `back` always runs
 *  (a ref, so the registration never churns per render), and unmount clears
 *  it — not the caller's to forget. */
export function useTopBackFor(back: () => void) {
  const ref = useRef(back);
  ref.current = back;
  useEffect(() => {
    setTopBack(() => ref.current());
    return () => setTopBack(null);
  }, []);
}
