import { supabase } from './supabase';

export interface FeedPostRow {
  id: string;
  author: 'member' | 'claude';
  body: string;
  source_post_id: string | null;
  thread: string;
  created_at: string;
}

// THREADS (founder 2026-08-11): the assistant keeps rooms that mirror the
// platform, so work stays where it belongs — press AI inside Marketplace and
// what you say is logged in the marketplace room. General is the room that
// isn't about one section, and the one that can draw on all of them.
export interface AssistantThread { id: string; label: string; blurb: string }

export const ASSISTANT_THREADS: AssistantThread[] = [
  { id: 'general', label: 'General', blurb: 'Anything at all — and it can draw on the rest.' },
  { id: 'profile', label: 'Profile management', blurb: 'Your presence: page, story, what you offer.' },
  { id: 'market', label: 'Marketplace', blurb: 'What you’re offering and looking for.' },
  { id: 'events', label: 'Events', blurb: 'Gatherings you host or attend.' },
  { id: 'calendar', label: 'Calendar', blurb: 'Time, bookings, who can see what.' },
  { id: 'concierge', label: 'Concierge', blurb: 'Care — yours and the people you hold.' },
];

export const threadLabel = (id: string) =>
  ASSISTANT_THREADS.find((t) => t.id === id)?.label ?? 'General';

/** A section key (sections.ts) → the room its work belongs in. Anything
 *  without a room of its own lands in general rather than inventing one. */
export function threadForSection(section?: string | null): string {
  if (!section) return 'general';
  const known = ASSISTANT_THREADS.some((t) => t.id === section);
  return known ? section : 'general';
}

/** The member's own feed relationship with Claude, oldest → newest.
 *  `thread` narrows to one room; omit it for the whole relationship. */
export async function loadAssistantFeed(profileId: string, thread?: string): Promise<FeedPostRow[]> {
  let q = supabase
    .from('assistant_feed_posts')
    .select('id, author, body, source_post_id, thread, created_at')
    .eq('profile_id', profileId);
  if (thread) q = q.eq('thread', thread);
  const { data, error } = await q.order('created_at', { ascending: true });
  if (error) throw error;
  return (data as FeedPostRow[] | null) ?? [];
}

/** Which rooms this member has actually used — so the rail can lead with
 *  the live ones rather than showing six empty doors. */
export async function loadThreadCounts(profileId: string): Promise<Record<string, number>> {
  const { data } = await supabase
    .from('assistant_feed_posts').select('thread').eq('profile_id', profileId);
  const counts: Record<string, number> = {};
  ((data as { thread: string }[] | null) ?? []).forEach((r) => {
    counts[r.thread] = (counts[r.thread] ?? 0) + 1;
  });
  return counts;
}

/** Post into a room of your own feed — the assistant_on_feed_post trigger
 *  answers in the same room. */
export async function postToAssistantFeed(
  body: string, sourcePostId?: string, thread = 'general',
): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');
  const { error } = await supabase.from('assistant_feed_posts').insert({
    profile_id: user.id, author: 'member', body,
    source_post_id: sourcePostId ?? null, thread,
  });
  if (error) throw error;
}

/** Whether the member has actually used their Claude feed — a real post,
 *  not just having seen the row. */
export async function hasClaudeFeedActivity(me: string): Promise<boolean> {
  const { data } = await supabase.from('assistant_feed_posts').select('id').eq('profile_id', me).limit(1).maybeSingle();
  return !!data;
}
