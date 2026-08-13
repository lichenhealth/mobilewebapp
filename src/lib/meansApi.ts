import { supabase } from './supabase';

// The Economic aspect of the Web of Wellbeing (founder 2026-07-27): a member's
// honest financial picture, written by them, readable ONLY by them and their
// ACTIVE care team (RLS — the phone-number pattern). It informs subsidies and
// means-aware pricing; it is never displayed as a score, never counted,
// never compared. Everything degrades gracefully before the migration runs.

export const INCOME_BANDS = [
  { value: 'under_25k', label: 'Under $25k' },
  { value: '25k_50k', label: '$25k – $50k' },
  { value: '50k_100k', label: '$50k – $100k' },
  { value: '100k_200k', label: '$100k – $200k' },
  { value: 'over_200k', label: 'Over $200k' },
] as const;
export type IncomeBand = typeof INCOME_BANDS[number]['value'];
export const bandLabel = (v: string | null | undefined) =>
  INCOME_BANDS.find((b) => b.value === v)?.label ?? null;

export interface FinancialPosition {
  profile_id: string;
  income_band: IncomeBand | null;
  household_size: number | null;
  circumstances: string | null;
  /** Web of Wellbeing consent (founder 2026-08-11): true = active care
   *  team may read this; false = private to everyone — and the help built
   *  on it (money conversations, coaching, subsidies) can't reach them.
   *  The switch lives in Profile → Privacy. */
  care_team_visible: boolean;
  updated_at: string;
}

/** null = nothing shared (or table not migrated yet — same graceful face). */
export async function getFinancialPosition(profileId: string): Promise<FinancialPosition | null> {
  const { data, error } = await supabase
    .from('financial_positions')
    .select('profile_id, income_band, household_size, circumstances, care_team_visible, updated_at')
    .eq('profile_id', profileId)
    .maybeSingle();
  if (error) return null;
  return (data as FinancialPosition | null);
}

export async function saveFinancialPosition(
  fields: { income_band: IncomeBand | null; household_size: number | null; circumstances: string | null },
): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');
  const { error } = await supabase.from('financial_positions').upsert({
    profile_id: user.id, ...fields, updated_at: new Date().toISOString(),
  });
  if (error) throw error;
}

// ── Identity tags (PUBLIC half — fetched separately so profile screens keep
//    working before the column exists) ──────────────────────────────────────
export async function getIdentityTags(profileId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('profiles').select('identity_tags').eq('id', profileId).maybeSingle();
  if (error) return [];
  const tags = (data as { identity_tags?: string[] | null } | null)?.identity_tags;
  return Array.isArray(tags) ? tags : [];
}

export async function saveIdentityTags(tags: string[]): Promise<boolean> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const { error } = await supabase.from('profiles')
    .update({ identity_tags: tags.length ? tags : null }).eq('id', user.id);
  return !error;
}
