import { supabase } from './supabase';

// ─── Universal Current-cy, Phase 1 (settled 2026-07-18) ──────────────────────
// Transparent DB ledger, dollar-pegged unit, append-only. All writes go
// through SECURITY DEFINER RPCs; balances are private to their holders.

export type EntityType = 'profile' | 'space';

export interface LedgerEntry {
  id: string;
  from_type: EntityType | null;
  from_id: string | null;
  /** Null = a BURN — Current leaving circulation (the redemption channel,
   *  2026-08-13). nameOf renders the null side as 'Lichen'. */
  to_type: EntityType | null;
  to_id: string | null;
  amount: number;
  context: string;
  memo: string;
  created_at: string;
  /** resolved for display */
  from_name?: string;
  to_name?: string;
}

/** Balance for a profile or a space. Returns null (not 0) when the ledger
 *  isn't live yet. */
export async function balanceOf(type: EntityType, id: string): Promise<number | null> {
  const { data, error } = await supabase.rpc('ledger_balance', { p_type: type, p_id: id });
  if (error) { console.warn('ledger_balance:', error.message); return null; }
  return Number(data ?? 0);
}

/** Your balance. Returns null (not 0) when the ledger isn't live yet. */
export async function myBalance(me: string): Promise<number | null> {
  return balanceOf('profile', me);
}

/** Statement for a profile or a space, newest first, with names resolved. */
export async function statementOf(type: EntityType, id: string, limit = 20): Promise<LedgerEntry[]> {
  const { data, error } = await supabase.from('ledger_entries')
    .select('id, from_type, from_id, to_type, to_id, amount, context, memo, created_at')
    .or(`and(from_type.eq.${type},from_id.eq.${id}),and(to_type.eq.${type},to_id.eq.${id})`)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) { console.warn('myStatement:', error.message); return []; }
  const rows = ((data as LedgerEntry[] | null) ?? []).map((r) => ({ ...r, amount: Number(r.amount) }));

  const profIds = new Set<string>(); const spaceIds = new Set<string>();
  for (const r of rows) {
    if (r.from_type === 'profile' && r.from_id) profIds.add(r.from_id);
    if (r.from_type === 'space' && r.from_id) spaceIds.add(r.from_id);
    if (r.to_type === 'profile' && r.to_id) profIds.add(r.to_id);
    if (r.to_type === 'space' && r.to_id) spaceIds.add(r.to_id);
  }
  const [profs, sps] = await Promise.all([
    profIds.size ? supabase.from('profiles').select('id, full_name').in('id', [...profIds]) : Promise.resolve({ data: [] }),
    spaceIds.size ? supabase.from('spaces').select('id, name').in('id', [...spaceIds]) : Promise.resolve({ data: [] }),
  ]);
  const pName = new Map(((profs.data as { id: string; full_name: string | null }[] | null) ?? []).map((p) => [p.id, p.full_name ?? 'A member']));
  const sName = new Map(((sps.data as { id: string; name: string }[] | null) ?? []).map((s) => [s.id, s.name]));
  const nameOf = (t: EntityType | null, id: string | null) =>
    t === null || id === null ? 'Lichen'
      : t === 'profile' ? (pName.get(id) ?? 'A member') : (sName.get(id) ?? 'A group');
  return rows.map((r) => ({ ...r, from_name: nameOf(r.from_type, r.from_id), to_name: nameOf(r.to_type, r.to_id) }));
}

/** Your statement, newest first, with names resolved. */
export async function myStatement(me: string, limit = 20): Promise<LedgerEntry[]> {
  return statementOf('profile', me, limit);
}

export async function sendCurrentcy(
  fromType: EntityType, fromId: string,
  toType: EntityType, toId: string,
  amount: number, memo: string,
): Promise<void> {
  const { error } = await supabase.rpc('send_currentcy', {
    p_from_type: fromType, p_from_id: fromId,
    p_to_type: toType, p_to_id: toId,
    p_amount: amount, p_memo: memo,
  });
  if (error) throw error;
}

export async function mintCurrentcy(
  toType: EntityType, toId: string, amount: number, memo: string, context = 'grant',
): Promise<void> {
  const { error } = await supabase.rpc('mint_currentcy', {
    p_to_type: toType, p_to_id: toId, p_amount: amount, p_memo: memo, p_context: context,
  });
  if (error) throw error;
}

/** The number alone — the ⚡ and the word are rendered beside it, so the
 *  glyph can be a real icon rather than an emoji (founder 2026-08-05). */
export const fmtCurrentNum = (n: number) =>
  `${Number.isInteger(n) ? n : n.toFixed(2)}`;
export const fmtCurrent = (n: number) =>
  `${fmtCurrentNum(n)} Current-cy`;

// ─── Pending loads (founder 2026-10-02: "listed as a pending input, kinda
// like a checking account - with an estimated arrival time - kinda like
// venmo") — bank-transfer loads in transit, written by the stripe-webhook
// when a bank checkout completes, flipped to landed when the Current mints
// or failed if the bank returns the debit. Display-only; owner-read RLS.
export interface PendingLoad {
  id: string;
  amount_cents: number;
  status: 'pending' | 'landed' | 'failed';
  created_at: string;
  resolved_at: string | null;
}

/** Open pendings + recently-failed (last 14 days — the member should hear
 *  a bounce, not wonder forever). Landed rows step out: the Current itself
 *  is on the statement. */
export async function listPendingLoads(me: string): Promise<PendingLoad[]> {
  const since = new Date(Date.now() - 14 * 86400000).toISOString();
  const { data, error } = await supabase.from('pending_loads')
    .select('id, amount_cents, status, created_at, resolved_at')
    .eq('profile_id', me)
    .or(`status.eq.pending,and(status.eq.failed,resolved_at.gte.${since})`)
    .order('created_at', { ascending: false });
  if (error) { console.warn('listPendingLoads:', error.message); return []; }
  return (data as PendingLoad[] | null) ?? [];
}

/** Venmo-style estimate: ACH clears in ~4 business days. */
export function expectedBy(createdISO: string): string {
  const d = new Date(createdISO);
  let added = 0;
  while (added < 4) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() !== 0 && d.getDay() !== 6) added++;
  }
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

/** Keep an amount FIELD numeric as it's typed (founder 2026-10-02: "you can
 *  only enter in a number with budget, not words") — digits and one decimal
 *  point, two decimal places; everything else (letters, $, commas — pasted
 *  "$1,200.50" included) is dropped on the way in. Worn by every amount
 *  input in the wallet family: Budget's line amount, the Load amount, the
 *  Send amount. */
export const numericAmount = (raw: string): string => {
  const s = raw.replace(/[^0-9.]/g, '');
  const i = s.indexOf('.');
  if (i === -1) return s;
  return s.slice(0, i + 1) + s.slice(i + 1).replace(/\./g, '').slice(0, 2);
};

// ─── Money in (founder 2026-10-01) ──────────────────────────────────────────

/** The admin-set operating rate on donations (5–15%). Null means the
 *  platform_settings table isn't live yet (the money-in migration hasn't
 *  been applied) — callers treat null as "machinery not live" and keep the
 *  pre-rate behavior, including HIDING the load door: a payment door whose
 *  fulfillment path isn't live must never render. */
export async function operatingRate(): Promise<number | null> {
  const { data, error } = await supabase.from('platform_settings')
    .select('value').eq('key', 'operating_rate_pct').maybeSingle();
  if (error || !data) return null;
  const n = Number((data as { value: unknown }).value);
  return Number.isFinite(n) ? Math.max(5, Math.min(15, Math.round(n))) : null;
}

export async function setOperatingRate(pct: number): Promise<void> {
  const { error } = await supabase.rpc('set_operating_rate', { p_pct: pct });
  if (error) throw error;
}

/** Start a Stripe checkout that loads the signed-in member's own wallet —
 *  dollars in, Current minted 1:1 by the webhook once payment confirms. */
export async function startLoadCheckout(amountDollars: number): Promise<void> {
  const { data, error } = await supabase.functions.invoke('load-checkout', {
    body: { amount: amountDollars },
  });
  if (error || !(data as { url?: string } | null)?.url) {
    throw new Error((error as { message?: string } | null)?.message
      || (data as { error?: string } | null)?.error || 'Could not start checkout.');
  }
  window.location.href = (data as { url: string }).url;
}
