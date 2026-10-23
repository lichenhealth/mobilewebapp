// MORE GIFTS FOR YOU (founder 2026-10-23, on a gift post's page: "there
// should be a gray line and then list all other gift items that the person
// qualifies for (based on what we know about them) below it, so they can
// keep scrolling. Have those items listed in order of relevance. So, if more
// shirts that are similar are gifted on the platform … show those next, then
// less relevant items (e.g. anything in mens apparel, then apparel, etc)").
//
// DETERMINISTIC, no AI call — the smartSearch idiom. "Qualifies" means the
// gift's own targeting: a gift aimed at identities (details.forIdentities /
// legacy giftToIdentities) shows only to a viewer carrying one of those
// names in their identity_tags; an untargeted gift shows to everyone. The
// free-text `giftTo` phrasing is a human sentence, not machine-readable
// targeting — it never hides a gift, it just can't boost one.
//
// Relevance walks the founder's ladder: aimed at YOU > shares a category
// (the shirts) > same category FAMILY via categories.parent_id (men's
// apparel → apparel) > title-word overlap > any other gift you qualify for,
// newest first inside a tie.

import { supabase } from './supabase';
import { loadFeed, postAreas, type FeedPost } from './postsApi';

export function giftMode(p: FeedPost): boolean {
  const d = (p.details ?? {}) as { modes?: unknown; mode?: unknown };
  if (Array.isArray(d.modes) && (d.modes as unknown[]).includes('gift')) return true;
  return d.mode === 'gift';
}

function targetIdentities(p: FeedPost): string[] {
  const d = (p.details ?? {}) as { forIdentities?: unknown; giftToIdentities?: unknown };
  const names = [
    ...(Array.isArray(d.forIdentities) ? (d.forIdentities as unknown[]) : []),
    ...(Array.isArray(d.giftToIdentities) ? (d.giftToIdentities as unknown[]) : []),
  ].filter((x): x is string => typeof x === 'string');
  return names.map((n) => n.toLowerCase());
}

function categoryIds(p: FeedPost): string[] {
  const d = (p.details ?? {}) as { categories?: unknown };
  return Array.isArray(d.categories)
    ? (d.categories as unknown[]).filter((x): x is string => typeof x === 'string')
    : [];
}

const STOP = new Set(['with', 'from', 'this', 'that', 'your', 'size', 'sizes', 'like', 'and', 'the', 'for']);
function titleWords(p: FeedPost): Set<string> {
  return new Set(
    (p.title ?? '').toLowerCase().split(/[^a-z0-9]+/)
      .filter((w) => w.length > 3 && !STOP.has(w))
  );
}

export async function loadRelatedGifts(current: FeedPost, me: string | null): Promise<FeedPost[]> {
  // What we know about the viewer: their own declared identities (their own
  // profile row — never anyone else's data).
  let myTags: string[] = [];
  if (me) {
    const { data } = await supabase.from('profiles').select('identity_tags').eq('id', me).maybeSingle();
    const t = (data as { identity_tags?: unknown } | null)?.identity_tags;
    if (Array.isArray(t)) myTags = (t as unknown[]).filter((x): x is string => typeof x === 'string').map((x) => x.toLowerCase());
  }

  // Candidates: recent posts the viewer can read (loadFeed already drops
  // hidden posts centrally), narrowed to gifts that aren't this one.
  const feed = await loadFeed(150);
  const gifts = feed.filter((p) =>
    p.id !== current.id
    && p.content_type === 'actionable'
    && giftMode(p)
    && !(p.details as { demo?: boolean } | null)?.demo
  );

  // Qualification: targeted gifts need an identity match.
  const qualified = gifts.filter((p) => {
    const aim = targetIdentities(p);
    return aim.length === 0 || aim.some((n) => myTags.includes(n));
  });
  if (qualified.length === 0) return [];

  // Category FAMILIES — one read for every id in play; a category's root is
  // its parent chain's top (the vocabulary is shallow: root or one parent).
  const curCats = categoryIds(current);
  const allIds = new Set<string>(curCats);
  qualified.forEach((p) => categoryIds(p).forEach((c) => allIds.add(c)));
  const rootOf = new Map<string, string>();
  if (allIds.size > 0) {
    const { data } = await supabase.from('categories').select('id, parent_id').in('id', [...allIds]);
    for (const row of (data as { id: string; parent_id: string | null }[] | null) ?? []) {
      rootOf.set(row.id, row.parent_id ?? row.id);
    }
  }
  const curRoots = new Set(curCats.map((c) => rootOf.get(c) ?? c));
  const curWords = titleWords(current);
  const curAreas = new Set(postAreas(current));

  const scored = qualified.map((p) => {
    let score = 0;
    const aim = targetIdentities(p);
    if (aim.length > 0 && aim.some((n) => myTags.includes(n))) score += 5;
    const cats = categoryIds(p);
    const shared = cats.filter((c) => curCats.includes(c));
    score += Math.min(shared.length, 2) * 4;
    if (shared.length === 0 && cats.some((c) => curRoots.has(rootOf.get(c) ?? c))) score += 2;
    let words = 0;
    for (const w of titleWords(p)) if (curWords.has(w)) words++;
    score += Math.min(words, 3);
    if ([...postAreas(p)].some((a) => a !== 'marketplace' && curAreas.has(a))) score += 1;
    return { p, score };
  });

  scored.sort((a, b) => b.score - a.score || b.p.created_at.localeCompare(a.p.created_at));
  return scored.slice(0, 12).map((s) => s.p);
}
