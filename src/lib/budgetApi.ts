import { supabase } from './supabase';

// ─── Budget (founder 2026-10-02) ────────────────────────────────────────────
// "Like a bank account, but also like budgeting software": balance, energy
// in and out per month or year from the REAL ledger, a procure list whose
// platform items pull their price live from the listing (by reference — it
// can't go stale), and manual lines for life outside Lichen (the mortgage).
// Strictly private (owner-only RLS, the saved_items doctrine) and planning
// only — nothing here ever moves a Current.

export type BudgetDirection = 'in' | 'out';
export type BudgetCadence = 'once' | 'monthly' | 'yearly';
/** Four buckets (founder 2026-10-02, superseding the energy vocabulary):
 *  expense — what life asks of you and you pay (incl. the procure list);
 *  income — what you provide expecting Current back; gift — offered freely,
 *  no reciprocal compensation; need — what you need but can't fund (the
 *  acupuncture case: not an expense, because the funds aren't there — its
 *  door is "Ask the network", the gift/ISO matcher). `direction` stays
 *  underneath (expense/need out, income/gift in). */
export type BudgetBucket = 'expense' | 'income' | 'gift' | 'need';
export const bucketDirection = (b: BudgetBucket): BudgetDirection =>
  b === 'income' || b === 'gift' ? 'in' : 'out';

export interface BudgetItem {
  id: string;
  post_id: string | null;
  label: string | null;
  amount_cents: number | null;
  direction: BudgetDirection;
  bucket: BudgetBucket;
  cadence: BudgetCadence;
  /** One-time lines may carry a date — the Month/Year view nests them into
   *  that month and year (founder 2026-10-02); null = standing (shows in
   *  every view — legacy rows and bolt-added listings). */
  on_date: string | null;
  created_at: string;
  /** Resolved for post-linked rows at render. */
  postTitle?: string;
  /** Null = the listing names no number (gift, trade, unpriced). */
  postPriceCents?: number | null;
  /** The listing is gone or no longer visible to this member. */
  postGone?: boolean;
}

/** The exchange freeze's own rule: the FIRST number in the price text
 *  ("sliding $10–$25" reads as 10, never 1025). */
export function priceCents(text: string | undefined | null): number | null {
  const m = (text ?? '').match(/[0-9]+\.?[0-9]*/);
  return m ? Math.round(parseFloat(m[0]) * 100) : null;
}

export async function listBudget(me: string): Promise<BudgetItem[]> {
  const { data, error } = await supabase.from('budget_items')
    .select('id, post_id, label, amount_cents, direction, bucket, cadence, on_date, created_at')
    .eq('profile_id', me)
    .order('created_at', { ascending: false });
  if (error) { console.warn('listBudget:', error.message); return []; }
  const rows = ((data as BudgetItem[] | null) ?? []);
  const ids = rows.filter((r) => r.post_id).map((r) => r.post_id as string);
  if (ids.length) {
    const { data: posts } = await supabase.from('posts')
      .select('id, title, details').in('id', ids);
    const byId = new Map(
      ((posts as { id: string; title: string | null; details: { price?: string } | null }[] | null) ?? [])
        .map((p) => [p.id, p]),
    );
    for (const r of rows) {
      if (!r.post_id) continue;
      const p = byId.get(r.post_id);
      if (!p) { r.postGone = true; continue; }
      r.postTitle = p.title || 'Untitled listing';
      r.postPriceCents = priceCents(p.details?.price);
    }
  }
  return rows;
}

/** Which listings already sit on my budget — powers the PostPage toggle. */
export async function listBudgetPostIds(me: string): Promise<Set<string>> {
  const { data } = await supabase.from('budget_items')
    .select('post_id').eq('profile_id', me).not('post_id', 'is', null);
  return new Set(((data as { post_id: string }[] | null) ?? []).map((r) => r.post_id));
}

export async function addBudgetPost(me: string, postId: string): Promise<void> {
  const { error } = await supabase.from('budget_items')
    .insert({ profile_id: me, post_id: postId, direction: 'out', cadence: 'once' });
  // Already on the budget (the partial unique index) is a fine answer.
  if (error && error.code !== '23505') throw error;
}

export async function removeBudgetPost(me: string, postId: string): Promise<void> {
  const { error } = await supabase.from('budget_items')
    .delete().eq('profile_id', me).eq('post_id', postId);
  if (error) throw error;
}

export async function addBudgetManual(me: string, item: {
  label: string; amountCents: number; bucket: BudgetBucket; cadence: BudgetCadence;
  onDate?: string | null;
}): Promise<void> {
  const { error } = await supabase.from('budget_items').insert({
    profile_id: me, label: item.label, amount_cents: item.amountCents,
    bucket: item.bucket, direction: bucketDirection(item.bucket), cadence: item.cadence,
    on_date: item.cadence === 'once' ? (item.onDate || null) : null,
  });
  if (error) throw error;
}

export async function removeBudgetItem(id: string): Promise<void> {
  const { error } = await supabase.from('budget_items').delete().eq('id', id);
  if (error) throw error;
}

export interface LedgerFlows { inAmt: number; outAmt: number }

/** The member's own live Marketplace listings as lowercase text — the
 *  smart List door's source (founder 2026-10-02: "if you've already listed
 *  your service or goods on marketplace it says nothing, but has a 'list on
 *  marketplace' if you haven't yet"). Deterministic word matching, the
 *  smartSearch idiom — no AI call, the card must be instant. */
export async function listMyMarketplaceTexts(me: string): Promise<string[]> {
  const { data, error } = await supabase.from('posts')
    .select('title, body')
    .eq('author_id', me)
    .contains('service_areas', ['marketplace'])
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) { console.warn('listMyMarketplaceTexts:', error.message); return []; }
  return ((data ?? []) as { title: string | null; body: string | null }[])
    .map((p) => `${p.title ?? ''} ${p.body ?? ''}`.toLowerCase());
}

/** Real energy in / out for the member since `fromISO` — summed from the
 *  ledger itself, so the budget can never disagree with the statement. */
export async function ledgerFlows(me: string, fromISO: string): Promise<LedgerFlows> {
  const { data, error } = await supabase.from('ledger_entries')
    .select('amount, from_type, from_id, to_type, to_id')
    .or(`and(from_type.eq.profile,from_id.eq.${me}),and(to_type.eq.profile,to_id.eq.${me})`)
    .gte('created_at', fromISO);
  if (error) { console.warn('ledgerFlows:', error.message); return { inAmt: 0, outAmt: 0 }; }
  let inAmt = 0, outAmt = 0;
  for (const e of (data as { amount: number; from_type: string | null; from_id: string | null; to_type: string | null; to_id: string | null }[] | null) ?? []) {
    if (e.to_type === 'profile' && e.to_id === me) inAmt += Number(e.amount);
    if (e.from_type === 'profile' && e.from_id === me) outAmt += Number(e.amount);
  }
  return { inAmt, outAmt };
}
