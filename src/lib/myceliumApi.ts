import { supabase } from './supabase';
import type { MyceliumSignals, MyceliumMember } from '../components/EngagementFooter';

// Trust / "Add to Mycelium" is one polymorphic edge: you → (target_type, target_id).
export type TargetType = 'profile' | 'space' | 'post';

const myceliumKey = (type: TargetType, id: string) => `${type}:${id}`;

/** Everything the current user trusts, as a set of `${type}:${id}` keys. */
export async function loadMyMycelium(): Promise<Set<string>> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Set();
  const { data } = await supabase
    .from('mycelium')
    .select('target_type, target_id')
    .eq('truster_id', user.id);
  return new Set((data ?? []).map((r) => myceliumKey(r.target_type as TargetType, r.target_id)));
}

/** Trust (add) or untrust (remove) an entity. */
export async function setTrust(type: TargetType, id: string, on: boolean): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');
  if (on) {
    const { error } = await supabase
      .from('mycelium')
      .insert({ truster_id: user.id, target_type: type, target_id: id });
    if (error && error.code !== '23505') throw error; // ignore duplicate
  } else {
    const { error } = await supabase
      .from('mycelium')
      .delete()
      .eq('truster_id', user.id).eq('target_type', type).eq('target_id', id);
    if (error) throw error;
  }
}

/** Everything the current user recommends, as `${type}:${id}` keys (same
 *  polymorphic shape as trust — posts, profiles, and spaces alike). */
export async function loadMyRecommendations(): Promise<Set<string>> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Set();
  const { data } = await supabase
    .from('recommendations')
    .select('target_type, target_id')
    .eq('recommender_id', user.id);
  return new Set((data ?? []).map((r) => myceliumKey(r.target_type as TargetType, r.target_id)));
}

/** Recommend (amplify) or un-recommend an entity — a post, a person, a space. */
export async function setRecommend(type: TargetType, id: string, on: boolean): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');
  if (on) {
    const { error } = await supabase
      .from('recommendations')
      .insert({ recommender_id: user.id, target_type: type, target_id: id });
    if (error && error.code !== '23505') throw error;
  } else {
    const { error } = await supabase
      .from('recommendations')
      .delete()
      .eq('recommender_id', user.id).eq('target_type', type).eq('target_id', id);
    if (error) throw error;
  }
}

/**
 * The endorsement overlay: for each post, which of MY mycelium members trust its
 * author or recommend it. This is the trust lens — `(endorsers) ∩ (your mycelium)`.
 * Returns a map of post id → signals (only posts with at least one endorser).
 */
export async function loadEndorsements(
  posts: { id: string; author_id: string }[],
  myMycelium: Set<string>,
): Promise<Record<string, MyceliumSignals>> {
  const myProfileIds = [...myMycelium]
    .filter((k) => k.startsWith('profile:'))
    .map((k) => k.slice('profile:'.length));
  if (myProfileIds.length === 0 || posts.length === 0) return {};

  const authorIds = [...new Set(posts.map((p) => p.author_id))];
  const postIds = posts.map((p) => p.id);

  const [{ data: trustRows }, { data: recRows }, { data: profs }] = await Promise.all([
    supabase.from('mycelium').select('truster_id, target_id')
      .eq('target_type', 'profile').in('target_id', authorIds).in('truster_id', myProfileIds),
    supabase.from('recommendations').select('recommender_id, target_id')
      .eq('target_type', 'post').in('target_id', postIds).in('recommender_id', myProfileIds),
    supabase.from('profiles').select('id, full_name, handle').in('id', myProfileIds),
  ]);

  const member = (id: string): MyceliumMember => {
    const p = (profs ?? []).find((x) => x.id === id);
    const name = p?.full_name || 'Member';
    return {
      handle: '@' + (p?.handle || name.toLowerCase().replace(/\s+/g, '-')),
      name,
      monogram: name.charAt(0).toUpperCase(),
    };
  };

  // author → my-mycelium members who trust that author (so all their posts inherit it)
  const trustByAuthor = new Map<string, MyceliumMember[]>();
  for (const r of trustRows ?? []) {
    const arr = trustByAuthor.get(r.target_id) ?? [];
    arr.push(member(r.truster_id));
    trustByAuthor.set(r.target_id, arr);
  }
  // post → my-mycelium members who recommend that specific post
  const recByPost = new Map<string, MyceliumMember[]>();
  for (const r of recRows ?? []) {
    const arr = recByPost.get(r.target_id) ?? [];
    arr.push(member(r.recommender_id));
    recByPost.set(r.target_id, arr);
  }

  const out: Record<string, MyceliumSignals> = {};
  for (const p of posts) {
    const trusted = trustByAuthor.get(p.author_id);
    const recommended = recByPost.get(p.id);
    if (trusted?.length || recommended?.length) {
      out[p.id] = { trusted, recommended };
    }
  }
  return out;
}
