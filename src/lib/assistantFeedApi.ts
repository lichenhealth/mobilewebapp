import { supabase } from './supabase';

export interface FeedPostRow {
  id: string;
  author: 'member' | 'claude';
  body: string;
  source_post_id: string | null;
  created_at: string;
}

/** The member's own feed relationship with Claude, oldest → newest. */
export async function loadAssistantFeed(profileId: string): Promise<FeedPostRow[]> {
  const { data, error } = await supabase
    .from('assistant_feed_posts')
    .select('id, author, body, source_post_id, created_at')
    .eq('profile_id', profileId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data as FeedPostRow[] | null) ?? [];
}

/** Post into your own feed — the assistant_on_feed_post trigger answers. */
export async function postToAssistantFeed(body: string, sourcePostId?: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');
  const { error } = await supabase.from('assistant_feed_posts').insert({
    profile_id: user.id, author: 'member', body, source_post_id: sourcePostId ?? null,
  });
  if (error) throw error;
}

/** Whether the member has actually used their Claude feed — a real post,
 *  not just having seen the row. */
export async function hasClaudeFeedActivity(me: string): Promise<boolean> {
  const { data } = await supabase.from('assistant_feed_posts').select('id').eq('profile_id', me).limit(1).maybeSingle();
  return !!data;
}
