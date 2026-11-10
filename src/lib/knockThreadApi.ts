import { supabase } from './supabase';

/** Each knock is a thread (founder 2026-11-10). Replies the stewards sent,
 *  oldest first; RLS lets only people who can read the knock read these. */
export type KnockReplyRow = { id: string; body: string; sent_at: string; sender: { full_name: string | null } | null };

export async function loadKnockReplies(knockId: string): Promise<KnockReplyRow[]> {
  const { data, error } = await supabase.from('knock_replies')
    .select('id, body, sent_at, sender:profiles!knock_replies_sent_by_fkey(full_name)')
    .eq('knock_id', knockId).order('sent_at', { ascending: true });
  if (error) { console.warn('loadKnockReplies:', error.message); return []; }
  return (data as unknown as KnockReplyRow[] | null) ?? [];
}

/** The colour of a knock's state: peach while it's in your hands, green once
 *  you let them in, red for not-a-fit and spam. */
export type KnockTone = 'open' | 'in' | 'out';
export function knockTone(status: string): KnockTone {
  if (status === 'invited') return 'in';
  if (status === 'declined' || status === 'spam') return 'out';
  return 'open';
}
export function knockStatusWord(status: string, repliedAt?: string | null): string {
  const d = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  if (status === 'invited') return 'Let in ✓';
  if (status === 'spam') return 'Spam';
  if (status === 'declined') return 'Not a fit';
  return repliedAt ? `Replied ${d(repliedAt)} · still at the door` : 'Waiting for you';
}
