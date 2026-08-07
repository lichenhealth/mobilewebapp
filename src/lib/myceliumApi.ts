import { supabase } from './supabase';
import type { MyceliumSignals, MyceliumMember } from '../components/EngagementFooter';

// Mycelium is one polymorphic edge: you → (target_type, target_id), with a
// PRIVATE `vouched` flag (founder, 2026-07-14): membership means "in my web,
// their doings flow to me" — trust is the vouch layered on top, never implied,
// never counted. Trusting auto-adds to the web; the reverse never happens.
export type TargetType = 'profile' | 'space' | 'post';

const myceliumKey = (type: TargetType, id: string) => `${type}:${id}`;

export interface MyWeb {
  web: Set<string>;      // everyone/everything in my mycelium (vouched ⊆ web)
  vouched: Set<string>;  // the subset I privately trust
}

/** My whole web, split into membership and trust. Keys are `${type}:${id}`. */
export async function loadMyWeb(): Promise<MyWeb> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { web: new Set(), vouched: new Set() };
  const { data } = await supabase
    .from('mycelium')
    .select('target_type, target_id, vouched')
    .eq('truster_id', user.id);
  const web = new Set<string>();
  const vouched = new Set<string>();
  for (const r of (data as { target_type: TargetType; target_id: string; vouched: boolean }[] | null) ?? []) {
    const k = myceliumKey(r.target_type, r.target_id);
    web.add(k);
    if (r.vouched) vouched.add(k);
  }
  return { web, vouched };
}

/** Back-compat wrapper: the full web as a flat set. */
export async function loadMyMycelium(): Promise<Set<string>> {
  return (await loadMyWeb()).web;
}

/** Weave into / remove from my mycelium (membership only — no vouch).
 *  Removing deletes the edge entirely: leaving the web withdraws trust too. */
export async function setInWeb(type: TargetType, id: string, on: boolean): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');
  if (on) {
    // Plain insert, duplicates ignored — must NEVER downgrade an existing vouch.
    const { error } = await supabase
      .from('mycelium')
      .insert({ truster_id: user.id, target_type: type, target_id: id, vouched: false });
    if (error && error.code !== '23505') throw error;
  } else {
    const { error } = await supabase
      .from('mycelium')
      .delete()
      .eq('truster_id', user.id).eq('target_type', type).eq('target_id', id);
    if (error) throw error;
  }
}

/** Vouch (trust) or unvouch. Vouching auto-adds to the web (upsert);
 *  unvouching keeps them in the web — it only withdraws the private signal. */
export async function setVouch(type: TargetType, id: string, on: boolean): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');
  if (on) {
    const { error } = await supabase
      .from('mycelium')
      .upsert(
        { truster_id: user.id, target_type: type, target_id: id, vouched: true },
        { onConflict: 'truster_id,target_type,target_id' },
      );
    if (error) throw error;
  } else {
    const { error } = await supabase
      .from('mycelium')
      .update({ vouched: false })
      .eq('truster_id', user.id).eq('target_type', type).eq('target_id', id);
    if (error) throw error;
  }
}

/** The feed cards' shield = vouch the author (trust implies adding). */
export const setTrust = setVouch;

/** Everything the current user recommends, as `${type}:${id}` keys (same
 *  polymorphic shape as trust — posts, profiles, and spaces alike). */
/** Keys are 'type:id' for a whole target, and 'type:id#category' for a
 *  recommendation tagged to one of a person's offerings. */
export async function loadMyRecommendations(): Promise<Set<string>> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Set();
  const { data } = await supabase
    .from('recommendations')
    .select('target_type, target_id, offering_category, recommender_space_id')
    .eq('recommender_id', user.id);
  const rows = (data ?? []) as {
    target_type: string; target_id: string;
    offering_category: string | null; recommender_space_id: string | null;
  }[];
  return new Set(rows.map((r) => recommendKey(
    r.target_type as TargetType, r.target_id,
    r.offering_category ?? undefined, r.recommender_space_id ?? undefined)));
}

export const recommendKey = (
  type: TargetType, id: string, category?: string, asSpace?: string,
) => {
  const base = category ? `${myceliumKey(type, id)}#${category}` : myceliumKey(type, id);
  return asSpace ? `${base}@${asSpace}` : base;
};

/** Recommend (amplify) or un-recommend — a post, a space, or ONE OF A
 *  PERSON'S OFFERINGS (founder 2026-08-06: you don't recommend a person, you
 *  recommend their work). `category` is a category id the person actually
 *  lists; the DB trigger refuses anything else. */
export async function setRecommend(
  type: TargetType, id: string, on: boolean, category?: string, asSpace?: string,
): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');
  if (on) {
    const { error } = await supabase
      .from('recommendations')
      .insert({
        recommender_id: user.id,
        // Speaking for a space you administer (founder 2026-08-06). The DB
        // re-checks adminship; trust deliberately has no equivalent.
        recommender_space_id: asSpace ?? null,
        target_type: type, target_id: id,
        offering_category: category ?? null,
      });
    if (error && error.code !== '23505') throw error;
  } else {
    let q = supabase.from('recommendations').delete()
      .eq('recommender_id', user.id).eq('target_type', type).eq('target_id', id);
    q = category ? q.eq('offering_category', category) : q.is('offering_category', null);
    q = asSpace ? q.eq('recommender_space_id', asSpace) : q.is('recommender_space_id', null);
    const { error } = await q;
    if (error) throw error;
  }
}

/**
 * The endorsement overlay: for each post, which of the people I TRUST vouch
 * for its author or recommend it. This is the trust lens —
 * `(endorsers) ∩ (people I trust)`. Pass the VOUCHED set (MyWeb.vouched):
 * web-only members don't speak for you, and only their vouched edges count.
 * Returns a map of post id → signals (only posts with at least one endorser).
 */
export async function loadEndorsements(
  posts: { id: string; author_id: string }[],
  myVouched: Set<string>,
): Promise<Record<string, MyceliumSignals>> {
  const myProfileIds = [...myVouched]
    .filter((k) => k.startsWith('profile:'))
    .map((k) => k.slice('profile:'.length));
  if (myProfileIds.length === 0 || posts.length === 0) return {};

  const authorIds = [...new Set(posts.map((p) => p.author_id))];
  const postIds = posts.map((p) => p.id);

  const [{ data: trustRows }, { data: recRows }, { data: profs }] = await Promise.all([
    supabase.from('mycelium').select('truster_id, target_id')
      .eq('target_type', 'profile').eq('vouched', true)
      .in('target_id', authorIds).in('truster_id', myProfileIds),
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


/** Keep only posts whose author (person OR the space they acted as) is woven
 *  into your web (founder 2026-08-07: "you can toggle to marketplace or events
 *  WITHIN your mycelium to switch places"). Your own posts always pass — you
 *  are the centre of your own web. Membership, not trust: the web is who you
 *  follow, and narrowing by trust is what the safety lens is for. */
export async function webAuthorFilter(): Promise<(p: {
  author_id: string | null; author_space_id: string | null;
}) => boolean> {
  const { web } = await loadMyWeb();
  const { data } = await supabase.auth.getUser();
  const me = data.user?.id ?? null;
  return (p) => {
    if (me && p.author_id === me) return true;
    if (p.author_space_id) return web.has('space:' + p.author_space_id);
    return !!p.author_id && web.has('profile:' + p.author_id);
  };
}
