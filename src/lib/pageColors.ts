// A PAGE'S OWN COLOURS (founder 2026-08-28).
//
// Three named looks — White, Lichen's warm paper, or the business's own —
// and the third can bring its own GROUND, not only its own accent ("can we
// make 'your branding' smart enough that you can decide to have the webpage
// be another color, versus white, if it looks good?").
//
// DARK WAS REMOVED the same day, and the reason is worth keeping. It looked
// broken because the page's text colours came from Lichen's global --ink
// family (#2A3338 nav links on a near-black ground — invisible), while only
// a couple of elements followed the page's own ink. That is fixed below by
// deriving the whole ink family from the ground, so a dark ground would now
// work. It is still gone, because the founder judged a black site wrong for
// the businesses on here — and because a logo drawn in dark ink on
// transparency, like Countryman's, vanishes on one no matter how correct
// the text colours are.
//
// So: an accent is FORCED readable on its ground, and a ground carries text
// colours derived from it rather than inherited. An owner cannot land on an
// unreadable page from either direction.

export type PageSurface = 'warm' | 'white';

/** The two named grounds. Anything else is a hex a logo suggested. */
export const SURFACES: Record<PageSurface, { ground: string; label: string; note: string }> = {
  white: { ground: '#FFFFFF', label: 'White',
           note: 'Clean and neutral. Good behind a logo with its own colours.' },
  warm:  { ground: '#F0EEE9', label: "Lichen's look",
           note: "Lichen's own paper tone — the default." },
};

export function parseHex(hex: string): [number, number, number] | null {
  const s = hex.trim().replace(/^#/, '');
  const full = s.length === 3 ? s.split('').map((c) => c + c).join('') : s;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [number, number, number];
}

const toHex = (rgb: [number, number, number]) =>
  '#' + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');

function luminance([r, g, b]: [number, number, number]): number {
  const lin = [r, g, b].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

export function contrast(a: string, b: string): number {
  const ca = parseHex(a); const cb = parseHex(b);
  if (!ca || !cb) return 1;
  const la = luminance(ca); const lb = luminance(cb);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** WCAG AA for body text. The accent is used for link text and small labels,
 *  not just decoration, so body text is the right bar. */
export const MIN_CONTRAST = 4.5;

const mix = (a: [number, number, number], b: [number, number, number], t: number) =>
  toHex([0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * t) as [number, number, number]);

export type ResolvedSurface = { ground: string; ink: string; muted: string; soft: string; edge: string };

/** Everything a ground needs, DERIVED from the ground rather than inherited.
 *  Lichen's global --ink family assumes light paper; a page that chose its
 *  own colour has to carry its own text colours or it inherits near-black on
 *  whatever it picked (founder 2026-08-28 — this is exactly what made the
 *  dark option look broken). Accepts a preset name or any hex. */
export function resolveSurface(value?: string | null): ResolvedSurface {
  const named = value === 'white' || value === 'warm' ? SURFACES[value].ground : null;
  const ground = named ?? (value && parseHex(value) ? toHex(parseHex(value)!) : SURFACES.warm.ground);
  const rgb = parseHex(ground)!;
  // Pick whichever of near-black / near-white reads better ON this ground,
  // then step the softer tones back toward the ground rather than toward
  // grey, so they stay in the page's own key.
  const dark: [number, number, number] = [18, 24, 28];
  const light: [number, number, number] = [242, 244, 245];
  const ink = contrast(toHex(dark), ground) >= contrast(toHex(light), ground) ? dark : light;
  return {
    ground,
    ink: toHex(ink),
    soft: mix(ink, rgb, 0.18),
    muted: mix(ink, rgb, 0.42),
    edge: mix(ink, rgb, 0.82),
  };
}

/** An accent the owner will be able to read on their ground. Their hue is
 *  kept; only lightness moves, and only as far as it must. */
export function readableAccent(accent: string, surfaceValue?: string | null): string | null {
  const rgb = parseHex(accent);
  if (!rgb) return null;
  const { ground, ink } = resolveSurface(surfaceValue);
  if (contrast(accent, ground) >= MIN_CONTRAST) return toHex(rgb);
  const groundIsDark = luminance(parseHex(ground)!) < 0.5;
  let cur: [number, number, number] = [...rgb] as [number, number, number];
  for (let i = 0; i < 60; i++) {
    cur = cur.map((v) => (groundIsDark ? v + (255 - v) * 0.06 : v * 0.94)) as [number, number, number];
    if (contrast(toHex(cur), ground) >= MIN_CONTRAST) return toHex(cur);
  }
  return ink;
}
