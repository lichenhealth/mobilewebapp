import { supabase } from './supabase';
import { loadMyWeb } from './myceliumApi';

// The safety piece (founder 2026-07-28): Lichen's answer to marketplace fear
// isn't ratings — it's YOUR path through the web. A scammer can farm five
// stars; they cannot fake being trusted by someone you trust. Everything here
// is VIEWER-relative and private: I see my path to a seller, you see yours,
// and nobody ever sees a count or a score.

interface Edge { actor: string; target_type: string; target_id: string }

export interface TrustWeb {
  me: string;
  myVouched: Set<string>;              // 'profile:<id>' / 'space:<id>' I trust
  edges: Edge[];                       // the platform's vouched edges
}

export type TrustDegree = 'mine' | 'second';
export interface TrustPathHit {
  degree: TrustDegree;
  via: string | null;                  // profile id of the person I trust who trusts them
}

export async function loadTrustWeb(me: string): Promise<TrustWeb> {
  const [{ vouched }, edgesRes] = await Promise.all([
    loadMyWeb(),
    supabase.from('mycelium').select('truster_id, target_type, target_id')
      .eq('vouched', true).limit(5000),
  ]);
  const edges: Edge[] = ((edgesRes.data as { truster_id: string; target_type: string; target_id: string }[] | null) ?? [])
    .map((e) => ({ actor: e.truster_id, target_type: e.target_type, target_id: e.target_id }));
  return { me, myVouched: vouched, edges };
}

/** My path to an entity: direct trust, one hop through someone I trust, or none. */
export function trustPathTo(web: TrustWeb, targetType: 'profile' | 'space', targetId: string): TrustPathHit | null {
  if (targetType === 'profile' && targetId === web.me) return { degree: 'mine', via: null };
  const key = `${targetType}:${targetId}`;
  if (web.myVouched.has(key)) return { degree: 'mine', via: null };
  const hop = web.edges.find((e) =>
    e.target_type === targetType && e.target_id === targetId
    && web.myVouched.has('profile:' + e.actor));
  if (hop) return { degree: 'second', via: hop.actor };
  return null;
}

/** Names for the "via" people, one batched fetch. */
export async function namesFor(ids: string[]): Promise<Map<string, string>> {
  const uniq = [...new Set(ids)].filter(Boolean);
  if (!uniq.length) return new Map();
  const { data } = await supabase.from('profiles').select('id, full_name').in('id', uniq);
  return new Map(((data as { id: string; full_name: string | null }[] | null) ?? [])
    .map((r) => [r.id, r.full_name ?? 'someone you trust']));
}

/** The sentence a member reads at the decision moment. */
export function trustPathLabel(hit: TrustPathHit, viaName?: string): string {
  if (hit.degree === 'mine') return hit.via === null && viaName === undefined ? 'Someone you trust' : 'Someone you trust';
  return viaName ? `Trusted by ${viaName} — someone you trust` : 'Trusted by someone you trust';
}
