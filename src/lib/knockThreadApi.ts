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
/** `joined` = the address now holds a Lichen account. An invitation SENT is
 *  not someone let in — Megan's card read green while her invite sat unused
 *  (founder 2026-11-10) — so green waits for the account. */
export function knockTone(status: string, joined?: boolean): KnockTone {
  if (status === 'invited') return joined ? 'in' : 'open';
  if (status === 'declined' || status === 'spam') return 'out';
  return 'open';
}
export function knockStatusWord(status: string, repliedAt?: string | null, joined?: boolean): string {
  const d = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  if (status === 'invited') return joined ? 'Joined Lichen ✓' : 'Invited · hasn\u2019t joined yet';
  if (status === 'spam') return 'Spam';
  if (status === 'declined') return 'Not yet \u2014 kept on file';
  return repliedAt ? `Replied ${d(repliedAt)} · still at the door` : 'Waiting for you';
}
