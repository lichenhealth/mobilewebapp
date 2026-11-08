import { supabase } from './supabase';

// THE MONEY SAFETY RAILS (founder 2026-11-08: "Can there be overdraft
// controls, too? Claude will alert you if you're outpacing your monthly
// budget"). The floor is enforced by the ledger itself — every send, trade
// and purchase, by hand or by Claude — and pacing is a daily check against
// the BudgetCard's planned monthly expenses. Both are the member's own.

export interface MoneySafeguards { floor: number | null; pacing: boolean }

export async function loadMoneySafeguards(): Promise<MoneySafeguards> {
  const { data } = await supabase.rpc('my_money_safeguards');
  const d = (data ?? {}) as { floor?: number | string | null; pacing?: boolean };
  return { floor: d.floor == null ? null : Number(d.floor), pacing: d.pacing !== false };
}

export async function saveMoneySafeguards(floor: number | null, pacing: boolean): Promise<MoneySafeguards> {
  const { data, error } = await supabase.rpc('set_money_safeguards', { p_floor: floor, p_pacing: pacing });
  if (error) throw new Error(error.message);
  const d = (data ?? {}) as { floor?: number | string | null; pacing?: boolean };
  return { floor: d.floor == null ? null : Number(d.floor), pacing: d.pacing !== false };
}
