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
  item_count: number;
}

type RawRow = Omit<CollectionRow, 'item_count' | 'owner' | 'details'> & {
  details: OfferingMeta | null;
  owner: { full_name: string | null } | null;
  collection_items: { count: number }[];
};

const COLLECTION_SELECT =
  'id, owner_id, name, description, is_public, kind, details, created_at, owner:profiles!collections_owner_id_fkey(full_name), collection_items(count)';

function shape(r: RawRow): CollectionRow {
  return { ...r, details: r.details ?? {}, item_count: r.collection_items?.[0]?.count ?? 0 };
}

/** My folders/playlists, newest first. */
export async function listMyCollections(): Promise<CollectionRow[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data, error } = await supabase
    .from('collections')
    .select(COLLECTION_SELECT)
    .eq('owner_id', user.id)
    .order('created_at', { ascending: false });
  if (error) { console.warn('listMyCollections:', error.message); return []; }
  return (((data as unknown as RawRow[] | null) ?? []).map(shape));
}

/** Published collections for the Library strip, newest first. Optionally scoped
 *  to a kind ('course' | 'path') for the section shelves. */
export async function listPublicCollections(limit = 12, kind?: CollectionKind): Promise<CollectionRow[]> {
  let q = supabase
    .from('collections')
    .select(COLLECTION_SELECT)
    .eq('is_public', true)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (kind) q = q.eq('kind', kind);
  const { data, error } = await q;
  if (error) { console.warn('listPublicCollections:', error.message); return []; }
  return (((data as unknown as RawRow[] | null) ?? []).map(shape));
}

export async function createCollection(name: string, kind: CollectionKind = 'collection'): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');
  const { data, error } = await supabase
    .from('collections')
    .insert({ owner_id: user.id, name: name.trim(), kind })
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
  const { data, error } = await supabase
    .from('collections')
    .select(COLLECTION_SELECT)
    .eq('id', id)
    .maybeSingle();
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
