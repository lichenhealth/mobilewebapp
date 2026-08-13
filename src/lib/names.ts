// Small shared naming helpers.

/** "Melanie's" but "Countryman Stables'" — a name already ending in s takes
 *  the bare apostrophe (founder 2026-08-11). */
export function possessive(name: string): string {
  const n = (name ?? '').trim();
  if (!n) return '';
  return /s$/i.test(n) ? `${n}\u2019` : `${n}\u2019s`;
}
