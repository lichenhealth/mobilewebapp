import type { SpaceKind } from './spacesApi';

/** Space names don't need to repeat their own kind — the page already prints
 *  "Group" / "Community" / "Organization" under the name, so
 *  "Melanie Bright Mentorship Group" reads as "…Group / Group" (founder,
 *  2026-08-05). We quietly trim the kind word when it's just bookending the
 *  name; anything mid-name ("Bailey Community Garden") is left alone. */

const KIND_WORDS: Record<SpaceKind, string[]> = {
  group: ['group', 'groups'],
  community: ['community', 'communities'],
  organization: ['organization', 'organizations', 'organisation', 'organisations', 'org', 'orgs'],
  // "place" is an ordinary English word ("The Gathering Place") — never trimmed.
  place: [],
};

/** Words that can't stand alone as a name — if trimming leaves only these, keep what was typed. */
const STOPWORDS = new Set(['the', 'a', 'an', 'our', 'my', 'your', 'this', 'of', 'and']);

const EDGE_PUNCT = /^[([{"'\-–—:,.]+|[)\]}"'\-–—:,.!]+$/g;

const bare = (token: string) => token.replace(EDGE_PUNCT, '').toLowerCase();

export interface TidyName {
  /** The name to save. */
  name: string;
  /** The word we trimmed, as the member typed it — null when nothing changed. */
  removed: string | null;
}

/** Trim a leading or trailing kind word from a space name. */
export function tidyName(raw: string, kind: SpaceKind): TidyName {
  const cleaned = raw.replace(/\s+/g, ' ').trim();
  const words = KIND_WORDS[kind];
  if (!cleaned || !words.length) return { name: cleaned, removed: null };

  const tokens = cleaned.split(' ');
  let removed: string | null = null;

  // Trailing: "Melanie Bright Mentorship Group", "Trail Crew (Group)", "Trail Crew — group"
  const last = tokens[tokens.length - 1];
  if (tokens.length > 1 && words.includes(bare(last))) {
    removed = bare(last);
    tokens.pop();
  } else if (tokens.length > 2) {
    // Leading, but only when a separator says it's a label: "Group: Trail Crew"
    const first = tokens[0];
    const labelled = /[:\-–—]$/.test(first) || /^[:\-–—]$/.test(tokens[1]);
    if (words.includes(bare(first)) && labelled) {
      removed = bare(first);
      tokens.shift();
      if (/^[:\-–—]$/.test(tokens[0])) tokens.shift();
    }
  }

  if (!removed) return { name: cleaned, removed: null };

  // Tidy up whatever the trim left behind: dangling separators, empty brackets.
  const name = tokens.join(' ').replace(/[\s\-–—:,]+$/, '').replace(/[([{]\s*$/, '').trim();

  // Never hand back a name that says nothing.
  const meaningful = name.split(' ').some((t) => bare(t) && !STOPWORDS.has(bare(t)));
  if (!meaningful) return { name: cleaned, removed: null };

  return { name, removed };
}

/** Same trim, name only — for the API layer, where there's no one to tell. */
export function tidySpaceName(raw: string, kind: SpaceKind): string {
  return tidyName(raw, kind).name;
}

/** The quiet line we show after auto-correcting a field. */
export function tidyNote(removed: string, kind: SpaceKind): string {
  const label = kind === 'organization' ? 'Organization' : kind === 'community' ? 'Community' : 'Group';
  return `Trimmed “${removed}” — the page already says ${label}.`;
}
