// Small shared naming helpers.

/** "Melanie's" but "Countryman Stables'" — a name already ending in s takes
 *  the bare apostrophe (founder 2026-08-11). */
export function possessive(name: string): string {
  const n = (name ?? '').trim();
  if (!n) return '';
  return /s$/i.test(n) ? `${n}\u2019` : `${n}\u2019s`;
}

/** Subject pronoun from a member's free-text pronouns field ("she/her" → she,
 *  "she/they" → she, "ze/zir" → ze). Unset stays they — never inferred from a
 *  name, the standing rule — and so does any first token we don't recognize
 *  as a subject pronoun ("any/all pronouns" must not become "any offers").
 *  `plural` says whether the verb conjugates like they ("they offer" /
 *  "she offers"). Spaces pass nothing and read as they.
 */
export function subjectPronoun(pronouns?: string | null): { word: string; plural: boolean } {
  const first = (pronouns ?? '').trim().toLowerCase().split(/[/\s,]+/)[0] ?? '';
  if (first === 'she' || first === 'he') return { word: first, plural: false };
  if (['ze', 'zie', 'sie', 'xe', 'ey', 'fae', 've', 'ne', 'per'].includes(first)) {
    return { word: first, plural: false };
  }
  return { word: 'they', plural: true };
}
