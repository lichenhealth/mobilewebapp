import { supabase } from './supabase';
import type { FeedPost } from './postsApi';
import type { PersonHit, SearchCriteria, SmartResults, SpaceHit } from './smartSearch';

// ─── The Assistant card (Figma 286-5477) ─────────────────────────────────────
// One Claude call per settled search, made by the assistant-search edge
// function. The deterministic engine finds; the assistant narrates. This file
// packs the results into a compact brief (top hits only, display fields only)
// so each call stays ~2K tokens.

export interface AssistantAnswer {
  available: boolean;   // false → hide the card (no key, model hiccup, refusal)
  capped?: boolean;     // true → daily cap reached, show the resting note
  text?: string;
}

const personBrief = (p: PersonHit) => ({
  name: p.full_name ?? 'A member',
  headline: p.headline,
  offers: p.categoryNames.slice(0, 4),
  near: p.place,
  miles_away: p.distanceMi != null ? Math.round(p.distanceMi) : null,
  recommended_by: p.recommenders.slice(0, 3),
  in_my_web: p.trusted,
});

const postBrief = (p: FeedPost) => ({
  title: p.title || p.body.slice(0, 80),
  by: p.author_space?.name || p.author?.full_name || 'A member',
  is_event: !!p.linked_event_id,
  offer: p.event_mode,
});

const spaceBrief = (s: SpaceHit) => ({
  name: s.name,
  kind: s.kind,
  where: s.location,
  miles_away: s.distanceMi != null ? Math.round(s.distanceMi) : null,
  recommended_by: s.recommenders.slice(0, 3),
  in_my_web: s.trusted,
});

export async function askAssistant(
  q: string,
  chips: string[],
  criteria: SearchCriteria,
  results: SmartResults,
): Promise<AssistantAnswer> {
  const { data, error } = await supabase.functions.invoke('assistant-search', {
    body: {
      q,
      chips,
      counts: {
        people: results.people.length,
        posts: results.posts.length,
        spaces: results.spaces.length,
      },
      // context the narrator needs to explain near-misses
      trust_degree: criteria.trust.degree,
      rec_degree: criteria.rec.degree,
      radius_miles: criteria.radiusMiles,
      people: results.people.slice(0, 8).map(personBrief),
      // Per-post consent (founder 2026-08-05): posts marked not-AI-readable
      // stay in the member's own results but never reach the narrator.
      posts: results.posts.filter((p) => !(p.details as { aiExcluded?: boolean } | null)?.aiExcluded).slice(0, 8).map(postBrief),
      spaces: results.spaces.slice(0, 8).map(spaceBrief),
    },
  });
  if (error) { console.warn('assistant:', error.message); return { available: false }; }
  return (data as AssistantAnswer | null) ?? { available: false };
}
