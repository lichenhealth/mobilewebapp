import { supabase } from './supabase';

// Hide — your private mute. Owner-only rows (RLS): the author never knows.
// Feed loaders filter against this set centrally, so every surface inherits it.

/** Post ids I've hidden. Anonymous → empty set. */
export async function loadMyHidden(): Promise<Set<string>> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Set();
  const { data } = await supabase
    .from('hidden_posts')
    .select('post_id')
    .eq('profile_id', user.id);
  return new Set(((data as { post_id: string }[] | null) ?? []).map((r) => r.post_id));
}

/** Hide (or unhide) a post — for me only. */
export async function setHidden(postId: string, on: boolean): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');
  if (on) {
    const { error } = await supabase
      .from('hidden_posts')
      .insert({ profile_id: user.id, post_id: postId });
    if (error && error.code !== '23505') throw error;
  } else {
    const { error } = await supabase
      .from('hidden_posts')
      .delete()
      .eq('profile_id', user.id).eq('post_id', postId);
    if (error) throw error;
  }
}
