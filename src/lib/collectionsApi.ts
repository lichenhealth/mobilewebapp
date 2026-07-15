import { supabase } from './supabase';
import { loadPostsByIds, type FeedPost } from './postsApi';

// Collections — one primitive, two faces: private folders for your Saved
// shelf, or published playlists/anthologies in the Lichen Library (public,
// curator attributed). Items are posts (extensible later).

export interface CollectionRow {
  id: string;
  owner_id: string;
  name: string;
  description: string | null;
  is_public: boolean;
  created_at: string;
  owner: { full_name: string | null } | null;
  item_count: number;
}

type RawRow = Omit<CollectionRow, 'item_count' | 'owner'> & {
  owner: { full_name: string | null } | null;
  collection_items: { count: number }[];
};

const COLLECTION_SELECT =
  'id, owner_id, name, description, is_public, created_at, owner:profiles!collections_owner_id_fkey(full_name), collection_items(count)';

function shape(r: RawRow): CollectionRow {
  return { ...r, item_count: r.collection_items?.[0]?.count ?? 0 };
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

/** Published collections for the Library strip, newest first. */
export async function listPublicCollections(limit = 12): Promise<CollectionRow[]> {
  const { data, error } = await supabase
    .from('collections')
    .select(COLLECTION_SELECT)
    .eq('is_public', true)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) { console.warn('listPublicCollections:', error.message); return []; }
  return (((data as unknown as RawRow[] | null) ?? []).map(shape));
}

export async function createCollection(name: string): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');
  const { data, error } = await supabase
    .from('collections')
    .insert({ owner_id: user.id, name: name.trim() })
    .select('id').single();
  if (error) throw error;
  return (data as { id: string }).id;
}

export async function updateCollection(id: string, patch: {
  name?: string; description?: string | null; is_public?: boolean;
}): Promise<void> {
  const { error } = await supabase.from('collections').update(patch).eq('id', id);
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
