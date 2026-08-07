import { useSyncExternalStore } from 'react';

/** ADMIN VIEW IS ONE STATE, READ IN TWO PLACES (founder 2026-08-08: "can we
 *  move admin view to where admin versus member is for each page owner, but
 *  for me, i see it there as lichen's admin?").
 *
 *  The toggle moved out of the side menu and onto the page itself, in the same
 *  spot a space's own Member view | Admin view control sits — so stewardship
 *  is flipped the same way everywhere, and on Lichen's own front door it means
 *  stewarding the platform. The side menu still READS the flag (blue desk
 *  badges, only the spaces you manage), so both surfaces need the same value
 *  the moment either changes — hence a tiny store rather than two useStates
 *  over the same localStorage key, which would have drifted apart. */

const KEY = 'menu-admin-view';
const listeners = new Set<() => void>();

export const adminViewOn = (): boolean => localStorage.getItem(KEY) === '1';

export const setAdminView = (on: boolean): void => {
  localStorage.setItem(KEY, on ? '1' : '');
  listeners.forEach((l) => l());
};

const subscribe = (l: () => void): (() => void) => {
  listeners.add(l);
  return () => { listeners.delete(l); };
};

export const useAdminView = (): boolean => useSyncExternalStore(subscribe, adminViewOn, () => false);
