import { supabase } from './supabase';
import { loadPostsByIds, type FeedPost } from './postsApi';

// Collections — one primitive, two faces: private folders for your Saved
// shelf, or published playlists/anthologies in the Lichen Library (public,
// curator attributed). Items are posts (extensible later).

export type CollectionKind = 'collection' | 'course' | 'path';

/** Legible "offering" metadata for a course/path — all optional. */
export interface OfferingMeta {
  level?: string;    // Intro · Deepening · Advanced (or free text)
  format?: string;   // Live · Self-paced · Mixed
  length?: string;   // "6 weeks", "4 lessons"
  forWhom?: string;  // "New practitioners"
  price?: string;    // "Free", "$120", "Sliding $40–$120"
  /** Canvas-style modules: named groups of lesson post ids, in order.
   *  Lessons not named in any module render under the default group. */
  modules?: { title: string; ids: string[] }[];
  /** The course's circle — a real Lichen GROUP (chat, events, find-a-time
   *  ride along for free). Set when the owner creates it. */
  circleId?: string;
  /** The teacher's own words on WHY this teaching is held closed — shown
   *  when a student expands the protection line (founder 2026-08-05).
   *  Empty falls back to the platform's standing promise. */
  protectedNote?: string;
  /** Hero image for the course room and the shelf (founder 2026-07-28). */
  coverUrl?: string;
  /** Protected teaching (founder 2026-08-05, the lineage-teacher promise):
   *  downloads off, recordings watermarked with each viewer's name, and the
   *  course never read by any assistant. Shown to students as a standing
   *  promise on the course page. */
  protectedTeaching?: boolean;
  /** The three content promises, split out of the old single
   *  `protectedTeaching` switch (founder 2026-08-15) so a teacher can hold
   *  one thing closed without closing all three. Absent = open; the legacy
   *  bundled flag still closes all three (see `contentPromises`). */
  shareable?: boolean;
  downloadable?: boolean;
  aiReadable?: boolean;
}

export interface CollectionRow {
  id: string;
  owner_id: string;
  name: string;
  description: string | null;
  is_public: boolean;
  kind: CollectionKind;
  details: OfferingMeta;
  created_at: string;
  owner: { full_name: string | null } | null;
  /** Space-owned collection (a group's Library/Courses) — duty-holders organize it. */
  space_id: string | null;
  space: { name: string | null } | null;
  item_count: number;
}

type RawRow = Omit<CollectionRow, 'item_count' | 'owner' | 'details' | 'space'> & {
  details: OfferingMeta | null;
  owner: { full_name: string | null } | null;
  space?: { name: string | null } | null;
  collection_items: { count: number }[];
};

const COLLECTION_SELECT =
  'id, owner_id, name, description, is_public, kind, details, created_at, space_id, space:spaces!collections_space_id_fkey(name), owner:profiles!collections_owner_id_fkey(full_name), collection_items(count)';
// pre-migration fallback (no space_id column yet)
const COLLECTION_SELECT_LEGACY =
  'id, owner_id, name, description, is_public, kind, details, created_at, owner:profiles!collections_owner_id_fkey(full_name), collection_items(count)';

function shape(r: RawRow): CollectionRow {
  return {
    ...r, details: r.details ?? {}, item_count: r.collection_items?.[0]?.count ?? 0,
    space_id: r.space_id ?? null, space: r.space ?? null,
  };
}

/** Run a collections query, retrying without the space fields when the
 *  migration hasn't landed yet (graceful pre-migration degrade). */
async function queryCollections(
  run: (select: string, hasSpace: boolean) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
): Promise<RawRow[]> {
  let { data, error } = await run(COLLECTION_SELECT, true);
  if (error) ({ data, error } = await run(COLLECTION_SELECT_LEGACY, false));
  if (error) { console.warn('collections:', error.message); return []; }
  return (data as RawRow[] | null) ?? [];
}

/** My PERSONAL folders/playlists, newest first (space-owned excluded — those
 *  live on their space's sections, not the Saved shelf). */
export async function listMyCollections(): Promise<CollectionRow[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const rows = await queryCollections((sel, hasSpace) => {
    let q = supabase.from('collections').select(sel)
      .eq('owner_id', user.id)
      .order('created_at', { ascending: false });
    if (hasSpace) q = q.is('space_id', null);
    return q;
  });
  return rows.map(shape);
}

/** Published collections for the Library strip, newest first. Optionally scoped
 *  to a kind ('course' | 'path') for the section shelves, or to one owner
 *  (member-scoped sections: "Melanie's courses to follow"). */
export async function listPublicCollections(limit = 12, kind?: CollectionKind, ownerId?: string): Promise<CollectionRow[]> {
  const rows = await queryCollections((sel) => {
    let q = supabase.from('collections').select(sel)
      .eq('is_public', true)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (kind) q = q.eq('kind', kind);
    if (ownerId) q = q.eq('owner_id', ownerId);
    return q;
  });
  return rows.map(shape);
}

/** A space's own collections (its Library/Courses). RLS shows members the
 *  private ones too; everyone else sees only the published. */
export async function listSpaceCollections(spaceId: string, kind?: CollectionKind): Promise<CollectionRow[]> {
  const rows = await queryCollections((sel, hasSpace) => {
    if (!hasSpace) return Promise.resolve({ data: [], error: null });
    let q = supabase.from('collections').select(sel)
      .eq('space_id', spaceId)
      .order('created_at', { ascending: false });
    if (kind) q = q.eq('kind', kind);
    return q;
  });
  return rows.map(shape);
}

export async function createCollection(name: string, kind: CollectionKind = 'collection', spaceId?: string): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');
  const { data, error } = await supabase
    .from('collections')
    .insert({ owner_id: user.id, name: name.trim(), kind, ...(spaceId ? { space_id: spaceId } : {}) })
    .select('id').single();
  if (error) throw error;
  return (data as { id: string }).id;
}

export async function updateCollection(id: string, patch: {
  name?: string; description?: string | null; is_public?: boolean;
  kind?: CollectionKind; details?: OfferingMeta;
}): Promise<void> {
  const { error } = await supabase.from('collections').update(patch).eq('id', id);
  if (error) throw error;
}

/** Reorder lessons: write each post's position to match the given order. */
export async function reorderItems(collectionId: string, orderedPostIds: string[]): Promise<void> {
  await Promise.all(orderedPostIds.map((pid, i) =>
    supabase.from('collection_items')
      .update({ position: i })
      .eq('collection_id', collectionId).eq('target_type', 'post').eq('target_id', pid)));
}

// ── Learner loop: enrollment + per-lesson progress (private to each learner) ──

/** Am I enrolled, and which lessons have I finished? */
export async function loadProgress(collectionId: string): Promise<{ enrolled: boolean; done: Set<string> }> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { enrolled: false, done: new Set() };
  const [enr, prog] = await Promise.all([
    supabase.from('collection_enrollments').select('collection_id')
      .eq('profile_id', user.id).eq('collection_id', collectionId).maybeSingle(),
    supabase.from('collection_progress').select('post_id')
      .eq('profile_id', user.id).eq('collection_id', collectionId),
  ]);
  const done = new Set(((prog.data as { post_id: string }[] | null) ?? []).map((r) => r.post_id));
  return { enrolled: !!enr.data, done };
}

/** Start a course/path (idempotent). */
export async function enroll(collectionId: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');
  const { error } = await supabase.from('collection_enrollments')
    .upsert({ profile_id: user.id, collection_id: collectionId }, { onConflict: 'profile_id,collection_id' });
  if (error) throw error;
}

/** Tick / untick a lesson for myself. */
export async function setLessonDone(collectionId: string, postId: string, done: boolean): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');
  if (done) {
    const { error } = await supabase.from('collection_progress')
      .upsert({ profile_id: user.id, collection_id: collectionId, post_id: postId }, { onConflict: 'profile_id,collection_id,post_id' });
    if (error) throw error;
  } else {
    const { error } = await supabase.from('collection_progress').delete()
      .eq('profile_id', user.id).eq('collection_id', collectionId).eq('post_id', postId);
    if (error) throw error;
  }
}

// ── Suggestions: members propose a piece or an organizational note; the
//    curators (owner + duty-holding space admins) accept or decline. ──────────

export interface CollectionSuggestionRow {
  id: string;
  collection_id: string;
  post_id: string | null;   // null = a free-text organizational note
  note: string | null;
  suggested_by: string;
  status: 'pending' | 'accepted' | 'declined';
  created_at: string;
  suggester: { full_name: string | null } | null;
}

/** Suggest an addition (postId) and/or an organizational change (note). */
export async function suggestToCollection(
  collectionId: string, opts: { postId?: string; note?: string },
): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');
  const { error } = await supabase.from('collection_suggestions').insert({
    collection_id: collectionId,
    post_id: opts.postId ?? null,
    note: opts.note?.trim() || null,
    suggested_by: user.id,
  });
  if (error) throw error;
}

/** Pending suggestions on a collection — curators see all, others their own. */
export async function listPendingSuggestions(collectionId: string): Promise<CollectionSuggestionRow[]> {
  const { data, error } = await supabase
    .from('collection_suggestions')
    .select('id, collection_id, post_id, note, suggested_by, status, created_at, suggester:profiles!collection_suggestions_suggested_by_fkey(full_name)')
    .eq('collection_id', collectionId)
    .eq('status', 'pending')
    .order('created_at');
  if (error) { console.warn('listPendingSuggestions:', error.message); return []; }
  return ((data as unknown as CollectionSuggestionRow[] | null) ?? []);
}

/** Curator accepts (piece appended) or declines (quietly). */
export async function resolveSuggestion(id: string, accept: boolean): Promise<void> {
  const { error } = await supabase.rpc('resolve_collection_suggestion', {
    p_id: id, p_accept: accept,
  });
  if (error) throw error;
}

/** Deleting a collection frees its posts (they stay saved/published). */
export async function deleteCollection(id: string): Promise<void> {
  const { error } = await supabase.from('collections').delete().eq('id', id);
  if (error) throw error;
}

/** Append a post (position = current count; duplicates ignored). */
export async function addToCollection(collectionId: string, postId: string): Promise<void> {
  const { count } = await supabase
    .from('collection_items')
    .select('*', { count: 'exact', head: true })
    .eq('collection_id', collectionId);
  const { error } = await supabase.from('collection_items').insert({
    collection_id: collectionId, target_type: 'post', target_id: postId,
    position: count ?? 0,
  });
  if (error && error.code !== '23505') throw error;
}

export async function removeFromCollection(collectionId: string, postId: string): Promise<void> {
  const { error } = await supabase.from('collection_items')
    .delete()
    .eq('collection_id', collectionId).eq('target_type', 'post').eq('target_id', postId);
  if (error) throw error;
}

/** A collection with its posts in curated order. Null when private + not mine. */
export async function loadCollection(id: string): Promise<{ meta: CollectionRow; posts: FeedPost[] } | null> {
  let { data, error } = await supabase
    .from('collections')
    .select(COLLECTION_SELECT)
    .eq('id', id)
    .maybeSingle();
  if (error) {
    ({ data, error } = await supabase
      .from('collections').select(COLLECTION_SELECT_LEGACY).eq('id', id).maybeSingle());
  }
  if (error || !data) return null;
  const meta = shape(data as unknown as RawRow);
  const { data: items } = await supabase
    .from('collection_items')
    .select('target_id, position')
    .eq('collection_id', id)
    .order('position');
  const ids = ((items as { target_id: string }[] | null) ?? []).map((r) => r.target_id);
  const posts = ids.length ? await loadPostsByIds(ids) : [];
  const order = new Map(ids.map((pid, i) => [pid, i]));
  posts.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  return { meta, posts };
}
