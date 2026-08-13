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
