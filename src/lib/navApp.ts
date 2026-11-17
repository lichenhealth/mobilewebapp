// WHICH MAPS APP COMES NEXT (founder 2026-11-17: "lichen first and apple next
// if on an iphone, and google next if on an android...but let's not assume. I
// use google maps, for example, on Apple"). Lichen always leads; after it, the
// member's own last pick on this device, else a guess that reads the BROWSER
// too — Chrome anywhere (CriOS on iOS) reads as a Google person.
export type NavApp = 'lichen' | 'apple' | 'google';

export function navPref(): NavApp | null {
  try {
    const v = localStorage.getItem('lichen.navApp');
    return v === 'lichen' || v === 'apple' || v === 'google' ? v : null;
  } catch { return null; }
}

export function rememberNavApp(k: NavApp) {
  try { localStorage.setItem('lichen.navApp', k); } catch { /* per-device nicety */ }
}

/** Apple vs Google — which outside app sits right after Lichen. */
export function outsideOrder(): ('apple' | 'google')[] {
  const p = navPref();
  if (p === 'apple') return ['apple', 'google'];
  if (p === 'google') return ['google', 'apple'];
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  const chrome = /CriOS|Chrome|Android/.test(ua);
  const appleDevice = /iPhone|iPad|iPod|Macintosh/.test(ua);
  return appleDevice && !chrome ? ['apple', 'google'] : ['google', 'apple'];
}

export const isAppleMapsUrl = (u: string) => /^https:\/\/maps\.apple\.com\/\?/.test(u);
export const isGoogleMapsUrl = (u: string) => /^https:\/\/www\.google\.com\/maps\//.test(u);
