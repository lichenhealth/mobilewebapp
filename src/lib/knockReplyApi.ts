import { supabase } from './supabase';

/** REPLY WITHOUT LETTING THEM IN (founder 2026-11-10): a steward writes back
 *  to someone at the door — the knock stays waiting, nothing invites them.
 *  The edge fn reads the knock through the caller's own RLS, so only someone
 *  who can see the knock can answer it; the recipient is the knock's email. */
export async function replyToKnock(knockId: string, message: string): Promise<{ replied_at: string; to: string }> {
  const { data, error } = await supabase.functions.invoke('knock-reply', { body: { knock_id: knockId, message } });
  if (error) {
    // functions.invoke hides the server's words in error.context.
    let msg = error.message;
    try { const j = await (error as { context?: Response }).context?.json(); if (j?.error) msg = j.error; } catch { /* keep */ }
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
  return data as { replied_at: string; to: string };
}

/** The signed-in person's public booking link, if they have a handle and
 *  at least one public session type — the one-tap insert in the reply box. */
export async function myBookingLink(me: string): Promise<string | null> {
  const { data: p } = await supabase.from('profiles').select('handle').eq('id', me).maybeSingle();
  const handle = (p as { handle: string | null } | null)?.handle;
  if (!handle) return null;
  const { count } = await supabase.from('booking_types').select('id', { count: 'exact', head: true })
    .eq('profile_id', me).eq('active', true).eq('audience', 'public');
  return (count ?? 0) > 0 ? `https://lichen.health/book/${handle}` : null;
}
