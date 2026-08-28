// A PAGE'S OWN COLOURS (founder 2026-08-28: "can they choose a white
// background and to pull their dark red in instead of our peach?").
//
// Two deliberate limits. The BACKGROUND is a choice from three grounds, not a
// colour picker — a free background field is how a non-technical owner ends
// up with an unreadable site and no idea why. The ACCENT is free, because it
// is theirs and it comes off their logo, but it is FORCED to be readable on
// whichever ground they chose. An owner cannot wreck their own page here.

export type PageSurface = 'warm' | 'white' | 'dark';

/** The three grounds. `ink` travels with the ground because text has to flip
 *  on a dark one — offering a background without its text colour is how you
 *  ship black-on-black. */
export const SURFACES: Record<PageSurface, { ground: string; ink: string; muted: string; edge: string; label: string; note: string }> = {
  warm:  { ground: '#F0EEE9', ink: '#12181C', muted: '#5B6B73', edge: '#D9D9D9',
           label: 'Warm',  note: "Lichen's own paper tone — the default." },
  white: { ground: '#FFFFFF', ink: '#12181C', muted: '#5B6B73', edge: '#E4E4E4',
           label: 'White',  note: 'Clean and neutral. Good behind a logo with its own colours.' },
  dark:  { ground: '#12181C', ink: '#F2F4F5', muted: '#A3B0B7', edge: '#2A3238',
           label: 'Dark',   note: 'Light text on a near-black ground.' },
};

/** #rgb or #rrggbb → [r,g,b] 0–255, or null if it isn't a colour. */
export function parseHex(hex: string): [number, number, number] | null {
  const s = hex.trim().replace(/^#/, '');
  const full = s.length === 3 ? s.split('').map((c) => c + c).join('') : s;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [number, number, number];
}

const toHex = (rgb: [number, number, number]) =>
  '#' + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');

/** WCAG relative luminance. */
function luminance([r, g, b]: [number, number, number]): number {
  const lin = [r, g, b].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

/** WCAG contrast ratio, 1 (identical) to 21 (black on white). */
export function contrast(a: string, b: string): number {
  const ca = parseHex(a); const cb = parseHex(b);
  if (!ca || !cb) return 1;
  const la = luminance(ca); const lb = luminance(cb);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** The floor. 4.5:1 is WCAG AA for body text, and the accent is used for
 *  link text and small labels, not just decoration — so body text is the
 *  right bar, not the large-text 3:1 concession. */
export const MIN_CONTRAST = 4.5;

/** An accent the owner will actually be able to read on their chosen ground.
 *  Their hue is kept; only lightness moves, and only as far as it has to.
 *  A colour that already passes is returned untouched — this is a floor, not
 *  a house style. Returns null for input that isn't a colour at all. */
export function readableAccent(accent: string, surface: PageSurface): string | null {
  const rgb = parseHex(accent);
  if (!rgb) return null;
  const { ground } = SURFACES[surface];
  if (contrast(accent, ground) >= MIN_CONTRAST) return toHex(rgb);
  // Walk toward black on a light ground, toward white on a dark one, in small
  // steps, and stop the moment it clears. 60 steps is enough to reach either
  // end from any starting colour.
  const towardWhite = surface === 'dark';
  let cur: [number, number, number] = [...rgb] as [number, number, number];
  for (let i = 0; i < 60; i++) {
    cur = cur.map((v) => (towardWhite ? v + (255 - v) * 0.06 : v * 0.94)) as [number, number, number];
    if (contrast(toHex(cur), ground) >= MIN_CONTRAST) return toHex(cur);
  }
  // Nothing in this hue works; fall back to the ground's own ink rather than
  // returning something unreadable.
  return SURFACES[surface].ink;
}
