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

/** My whole web, split into membership and trust. Keys are `${type}:${id}`.
 *  `asSpace` reads a SPACE's own web instead of mine — everything an admin
 *  wove while acting as it. A space's web never carries trust, so `vouched`
 *  comes back empty there by construction. */
export async function loadMyWeb(asSpace?: string): Promise<MyWeb> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { web: new Set(), vouched: new Set() };
  const q = supabase
    .from('mycelium')
    .select('target_type, target_id, vouched');
  const { data } = await (asSpace
    ? q.eq('truster_space_id', asSpace)
    : q.eq('truster_id', user.id).is('truster_space_id', null));
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
export async function setInWeb(
  type: TargetType, id: string, on: boolean, asSpace?: string,
): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');
  if (on) {
    // Plain insert, duplicates ignored — must NEVER downgrade an existing vouch.
    const { error } = await supabase
      .from('mycelium')
      .insert({
        truster_id: user.id,
        // Weaving on behalf of a space you administer, the same way
        // setRecommend speaks for one. The DB re-checks adminship; a space
        // edge can never be vouched, since trust stays person-to-person.
        truster_space_id: asSpace ?? null,
        target_type: type, target_id: id, vouched: false,
      });
    if (error && error.code !== '23505') throw error;
  } else {
    const q = supabase.from('mycelium').delete()
      .eq('target_type', type).eq('target_id', id);
    // A space's edge belongs to the SPACE, so any of its admins can undo it —
    // not only whoever happened to weave it.
    const { error } = await (asSpace
      ? q.eq('truster_space_id', asSpace)
      : q.eq('truster_id', user.id).is('truster_space_id', null));
    if (error) throw error;
  }
}

/** Vouch (trust) or unvouch. Vouching auto-adds to the web (upsert);
 *  unvouching keeps them in the web — it only withdraws the private signal. */
export async function setVouch(type: TargetType, id: string, on: boolean): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');
  // Update-then-insert rather than upsert: the personal edge is now a PARTIAL
  // unique index (…where truster_space_id is null), and ON CONFLICT can't
  // infer a partial index without repeating its WHERE clause, which PostgREST
  // has no way to send. Same effect, and a lost race still lands on 23505.
  if (on) {
    const { data: hit, error: uErr } = await supabase
      .from('mycelium')
      .update({ vouched: true })
      .eq('truster_id', user.id).eq('target_type', type).eq('target_id', id)
      .is('truster_space_id', null)
      .select('target_id');
    if (uErr) throw uErr;
    if (!hit?.length) {
      const { error } = await supabase
        .from('mycelium')
        .insert({
          truster_id: user.id, truster_space_id: null,
          target_type: type, target_id: id, vouched: true,
        });
      if (error && error.code !== '23505') throw error;
    }
  } else {
    const { error } = await supabase
      .from('mycelium')
      .update({ vouched: false })
      .eq('truster_id', user.id).eq('target_type', type).eq('target_id', id)
      .is('truster_space_id', null);
    if (error) throw error;
  }
}

/** The feed cards' shield = vouch the author (trust implies adding). */
export const setTrust = setVouch;

/** TRUST FOLLOWS THE POSTER (founder 2026-10-26: "the trust is simply always
 *  the trust of the poster, so the person, organization, place, community,
 *  group" + "Yes, I like the ability to trust an org. You can take that
 *  trust away, too"): a card's shield targets the DISPLAYED author — the
 *  SPACE when the post speaks in its voice, else the person — the same
 *  entity feedMapping's `weaveTarget` resolves. Superseded: the 2026-08-07
 *  person-only trust target (the `mycelium_no_space_trust` CHECK dropped in
 *  migration 20261026190000; `mycelium_space_cannot_vouch` STANDS — a space
 *  still holds no trust of its own). */
export function posterTrustKey(
  p: { author_id: string; author_space_id?: string | null },
): string {
  return p.author_space_id ? `space:${p.author_space_id}` : `profile:${p.author_id}`;
}

/** Vouch (or withdraw) the viewer's trust of a post's poster — person or
 *  space. The one write every card surface's onTrust routes through. */
export function trustPostPoster(
  p: { author_id: string; author_space_id?: string | null },
  on: boolean,
): Promise<void> {
  return p.author_space_id
    ? setVouch('space', p.author_space_id, on)
    : setVouch('profile', p.author_id, on);
}

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

// Fellow members of my spaces (communities/groups/orgs/places) — the "groups"
// half of the founder's network: "those within your network (mycelium, groups,
// etc)" (2026-10-12). Cached a few minutes so every feed load doesn't re-walk
// the rosters; space_members RLS already shows fellow members.
let matesCache: { me: string; at: number; ids: Set<string> } | null = null;
async function myFellowSpaceMembers(me: string): Promise<Set<string>> {
  if (matesCache && matesCache.me === me && Date.now() - matesCache.at < 5 * 60_000) {
    return matesCache.ids;
  }
  const { data: mine } = await supabase
    .from('space_members').select('space_id').eq('profile_id', me);
  const spaceIds = [...new Set(((mine ?? []) as { space_id: string }[]).map((r) => r.space_id))];
  let ids = new Set<string>();
  if (spaceIds.length) {
    const { data: mates } = await supabase
      .from('space_members').select('profile_id')
      .in('space_id', spaceIds).neq('profile_id', me);
    ids = new Set(((mates ?? []) as { profile_id: string }[]).map((r) => r.profile_id));
  }
  matesCache = { me, at: Date.now(), ids };
  return ids;
}

/**
 * The endorsement overlay for the lower-left signals (founder 2026-10-12:
 * "light up the icons in the lower left — when you scroll over the icon it
 * lists those within your network (mycelium, groups, etc) who recommend or
 * trust the post content or creator"). Never a count — relevance over volume.
 *
 * Two networks, deliberately different (the trust-privacy boundary):
 * - TRUSTED = people in YOUR WEB (mycelium membership) who vouch the POSTER —
 *   the person, or since 2026-10-26 the SPACE a post speaks for (founder:
 *   "I like the ability to trust an org… The trust is simply always the
 *   trust of the poster"). Trust is a private signal held by PEOPLE, so it
 *   surfaces only through people you yourself chose to weave in — never bare
 *   group-mates. Read via `trust_edges_for_targets()` (SECURITY DEFINER,
 *   scoped to the targets in view): mycelium's SELECT RLS is own-rows-only,
 *   so the old direct client read silently returned nothing — the shield
 *   could never light.
 * - RECOMMENDED = your web PLUS fellow members of your spaces who recommend
 *   the post or its creator. Recommendations are the public amplify signal,
 *   so the wider network is safe there.
 *
 * Pass the whole MyWeb; your own endorsements and the author's own never
 * list (your state is the lit action, an author endorsing themselves is noise).
 * Returns a map of post id → signals (only posts with at least one endorser).
 */
export async function loadEndorsements(
  posts: { id: string; author_id: string; author_space_id?: string | null }[],
  myWeb: MyWeb,
): Promise<Record<string, MyceliumSignals>> {
  const { data: { user } } = await supabase.auth.getUser();
  const me = user?.id ?? null;
  if (!me || posts.length === 0) return {};

  const webProfiles = new Set(
    [...myWeb.web].filter((k) => k.startsWith('profile:')).map((k) => k.slice('profile:'.length)),
  );
  webProfiles.delete(me);
  const mates = await myFellowSpaceMembers(me);
  const recNetwork = new Set([...webProfiles, ...mates]);
  recNetwork.delete(me);
  if (recNetwork.size === 0 && webProfiles.size === 0) return {};

  const postIds = posts.map((p) => p.id);
  const authorOf = new Map(posts.map((p) => [p.id, p.author_id]));
  // BOTH second-group signals follow the displayed POSTER: the space when the
  // post speaks in its voice, else the person (founder 2026-10-26 — orgs are
  // trustable, and their recs are first-class).
  const posterKeyOf = posterTrustKey;
  const personPosterIds = [...new Set(posts.filter((p) => !p.author_space_id).map((p) => p.author_id))];
  const spacePosterIds = [...new Set(posts.flatMap((p) => p.author_space_id ? [p.author_space_id] : []))];
  const trustTargets = [...new Set(posts.map(posterKeyOf))].map((k) => {
    const i = k.indexOf(':');
    return { type: k.slice(0, i), id: k.slice(i + 1) };
  });

  type RecRow = { recommender_id: string; target_type: string; target_id: string };
  const [trustRes, postRecRes, personRecRes, spaceRecRes] = await Promise.all([
    webProfiles.size
      ? supabase.rpc('trust_edges_for_targets', { p_targets: trustTargets })
      : Promise.resolve({ data: [] }),
    // A recommendation made AS a space is the space's voice, not a person in
    // your network speaking — personal rows only.
    supabase.from('recommendations').select('recommender_id, target_type, target_id')
      .eq('target_type', 'post').in('target_id', postIds)
      .is('recommender_space_id', null),
    personPosterIds.length
      ? supabase.from('recommendations').select('recommender_id, target_type, target_id')
          .eq('target_type', 'profile').in('target_id', personPosterIds)
          .is('recommender_space_id', null)
      : Promise.resolve({ data: [] as RecRow[] }),
    spacePosterIds.length
      ? supabase.from('recommendations').select('recommender_id, target_type, target_id')
          .eq('target_type', 'space').in('target_id', spacePosterIds)
          .is('recommender_space_id', null)
      : Promise.resolve({ data: [] as RecRow[] }),
  ]);

  const trustRows = ((trustRes.data ?? []) as { target_type: string; target_id: string; truster_id: string }[])
    .filter((r) => webProfiles.has(r.truster_id) && r.truster_id !== r.target_id);
  const postRecRows = ((postRecRes.data ?? []) as RecRow[])
    .filter((r) => recNetwork.has(r.recommender_id)
      && r.recommender_id !== authorOf.get(r.target_id));
  const posterRecRows = ([
    ...((personRecRes.data ?? []) as RecRow[]),
    ...((spaceRecRes.data ?? []) as RecRow[]),
  ]).filter((r) => recNetwork.has(r.recommender_id) && r.recommender_id !== r.target_id);

  const whoIds = [...new Set([
    ...trustRows.map((r) => r.truster_id),
    ...postRecRows.map((r) => r.recommender_id),
    ...posterRecRows.map((r) => r.recommender_id),
  ])];
  if (whoIds.length === 0) return {};
  const { data: profs } = await supabase
    .from('profiles').select('id, full_name, handle').in('id', whoIds);

  const member = (id: string): MyceliumMember => {
    const p = (profs ?? []).find((x) => x.id === id);
    const name = p?.full_name || 'Member';
    return {
      handle: '@' + (p?.handle || name.toLowerCase().replace(/\s+/g, '-')),
      name,
      monogram: name.charAt(0).toUpperCase(),
    };
  };

  // poster (person or space) → network members who trust them — every post in
  // that voice inherits it.
  const trustByTarget = new Map<string, Map<string, MyceliumMember>>();
  for (const r of trustRows) {
    const k = `${r.target_type}:${r.target_id}`;
    const m = trustByTarget.get(k) ?? new Map<string, MyceliumMember>();
    m.set(r.truster_id, member(r.truster_id));
    trustByTarget.set(k, m);
  }
  // post → network members who recommend that specific post
  const recByPost = new Map<string, Map<string, MyceliumMember>>();
  for (const r of postRecRows) {
    const m = recByPost.get(r.target_id) ?? new Map<string, MyceliumMember>();
    m.set(r.recommender_id, member(r.recommender_id));
    recByPost.set(r.target_id, m);
  }
  // poster (person or space) → network members who recommend THEM — their
  // whole body of offerings, not this one post.
  const recByPoster = new Map<string, Map<string, MyceliumMember>>();
  for (const r of posterRecRows) {
    const k = `${r.target_type}:${r.target_id}`;
    const m = recByPoster.get(k) ?? new Map<string, MyceliumMember>();
    m.set(r.recommender_id, member(r.recommender_id));
    recByPoster.set(k, m);
  }

  const out: Record<string, MyceliumSignals> = {};
  for (const p of posts) {
    const posterKey = posterKeyOf(p);
    const trustedMap = trustByTarget.get(posterKey);
    // RECOMMENDS ARE FIRST FOR THE SPECIFIC POST, then recommends of the
    // person (founder 2026-10-26: "Sarah Smith recommends these shirts…
    // and then after that Melanie Bright recommends Galyn" — a listing with
    // few recs of its own still shows the creator's network validation).
    // Deduped by person: someone recommending both lists once, as a post rec.
    const recList: MyceliumMember[] = [];
    const recSeen = new Set<string>();
    for (const [id, m] of recByPost.get(p.id) ?? new Map<string, MyceliumMember>()) {
      recList.push({ ...m, about: 'post' });
      recSeen.add(id);
    }
    for (const [id, m] of recByPoster.get(posterKey) ?? new Map<string, MyceliumMember>()) {
      if (recSeen.has(id)) continue;
      recList.push({ ...m, about: 'creator' });
      recSeen.add(id);
    }
    const trusted = trustedMap ? [...trustedMap.values()] : undefined;
    const recommended = recList.length ? recList : undefined;
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
