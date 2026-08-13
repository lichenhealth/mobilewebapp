import { supabase } from './supabase';

/** The marketplace's actual exchange (founder 2026-08-05: "lets build out
 *  marketplace for real"). Request → decide → both hands on the handoff, with
 *  a grown-up's yes in the middle when a young member is involved.
 *
 *  Every write is a SECURITY DEFINER RPC; the table has no write policies.
 *  Reads are parties-only, so "who claimed it" stays private — others learn
 *  only that something is spoken for, the resource_busy() stance. */

export type ExchangeStatus = 'pending' | 'accepted' | 'declined' | 'completed' | 'canceled';

export interface Exchange {
  id: string;
  post_id: string;
  seller_id: string;
  seller_space_id: string | null;
  buyer_id: string;
  /** Set when a SPACE is the buyer — buyer_id records which admin acted,
   *  the truster_id pattern. Completion debits the space's treasury. */
  buyer_space_id: string | null;
  mode: string;
  amount: number;
  fulfillment: string | null;
  note: string | null;
  status: ExchangeStatus;
  needs_guardian: boolean;
  guardian_ok_at: string | null;
  buyer_done_at: string | null;
  seller_done_at: string | null;
  created_at: string;
}

const COLS = 'id, post_id, seller_id, seller_space_id, buyer_id, buyer_space_id, mode, amount, fulfillment, note, status, needs_guardian, guardian_ok_at, buyer_done_at, seller_done_at, created_at';

/** The verb for a listing's primary action — a gift isn't bought. */
export function takeItLabel(mode?: string | null): string {
  switch (mode) {
    case 'sale': case 'sliding': return 'Buy it';
    case 'trade': return 'Offer a trade';
    case 'rent': return 'Rent it';
    case 'lend': case 'borrow': return 'Ask to borrow';
    case 'iso': return 'I have this';
    default: return 'Ask for it';
  }
}

export async function requestExchange(
  postId: string, mode?: string | null, fulfillment?: string | null, note?: string | null,
  asSpace?: string,
): Promise<{ ok: boolean; id?: string; message: string }> {
  const { data, error } = await supabase.rpc('request_exchange', {
    p_post: postId, p_mode: mode ?? null,
    p_fulfillment: fulfillment ?? null, p_note: note ?? null,
    // Buying on behalf of a space you steward (founder 2026-08-13). The DB
    // re-checks adminship, and the treasury — not you — pays at completion.
    p_as_space: asSpace ?? null,
  });
  if (error) return { ok: false, message: error.message };
  return { ok: true, id: data as string, message: 'Asked — they’ll get a bell.' };
}

export async function decideExchange(id: string, accept: boolean): Promise<{ ok: boolean; message: string }> {
  const { error } = await supabase.rpc('decide_exchange', { p_exchange: id, p_accept: accept });
  return error
    ? { ok: false, message: error.message }
    : { ok: true, message: accept ? 'Agreed — arrange the handoff.' : 'Passed. The listing stays open.' };
}

export async function approveAsGuardian(id: string): Promise<{ ok: boolean; message: string }> {
  const { error } = await supabase.rpc('approve_exchange_guardian', { p_exchange: id });
  return error ? { ok: false, message: error.message } : { ok: true, message: 'Approved.' };
}

export async function completeExchange(id: string): Promise<{ ok: boolean; message: string }> {
  const { error } = await supabase.rpc('complete_exchange', { p_exchange: id });
  return error
    ? { ok: false, message: error.message }
    : { ok: true, message: 'Marked done — it closes when you both have.' };
}

export async function cancelExchange(id: string): Promise<{ ok: boolean; message: string }> {
  const { error } = await supabase.rpc('cancel_exchange', { p_exchange: id });
  return error ? { ok: false, message: error.message } : { ok: true, message: 'Called off.' };
}

/** Is this listing spoken for? Yes/no only — never who. */
export async function isClaimed(postId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('post_claimed', { p_post: postId });
  return !error && data === true;
}

/** My exchange on this listing, if I have one (either side). */
export async function myExchangeForPost(
  postId: string, me: string, asSpace?: string,
): Promise<Exchange | null> {
  if (!me) return null;
  const q = supabase.from('exchanges').select(COLS).eq('post_id', postId);
  // Wearing a space's hat, "my exchange" is the SPACE's — any of its admins
  // sees and continues it, not just whoever asked. As yourself, your own.
  const { data, error } = await (asSpace
    ? q.eq('buyer_space_id', asSpace)
    : q.or(`buyer_id.eq.${me},seller_id.eq.${me}`))
    .not('status', 'in', '("declined","canceled")')
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (error) return null;
  return (data as Exchange | null) ?? null;
}

/** Everything in flight, both sides. Returns [] before the migration lands. */
export async function listMyExchanges(me: string): Promise<Exchange[]> {
  if (!me) return [];
  const { data, error } = await supabase.from('exchanges').select(COLS)
    .order('created_at', { ascending: false }).limit(100);
  if (error) return [];
  return (data as Exchange[] | null) ?? [];
}

/** Exchanges waiting on a grown-up I am. RLS already scopes this to the
 *  young people I hold, so no extra filter is needed. */
export async function listGuardianQueue(): Promise<Exchange[]> {
  const { data, error } = await supabase.from('exchanges').select(COLS)
    .eq('needs_guardian', true).is('guardian_ok_at', null)
    .in('status', ['pending', 'accepted'])
    .order('created_at', { ascending: false });
  if (error) return [];
  return (data as Exchange[] | null) ?? [];
}

/** What this exchange is waiting on, from my side — the row's next verb. */
export function nextStep(x: Exchange, me: string): string {
  if (x.status === 'pending') {
    return x.seller_id === me ? 'Waiting on you' : 'Waiting on them';
  }
  if (x.status === 'accepted') {
    if (x.needs_guardian && !x.guardian_ok_at) return 'Waiting on a grown-up';
    const mine = x.buyer_id === me ? x.buyer_done_at : x.seller_done_at;
    return mine ? 'Waiting on them to confirm' : 'Mark it done when it’s done';
  }
  if (x.status === 'completed') return 'Done';
  if (x.status === 'declined') return 'Passed';
  return 'Called off';
}
