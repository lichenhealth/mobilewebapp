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

/** What someone is asking the network to help carry (founder 2026-08-20).
 *  Time off is here because it's the one the ordinary system handles worst:
 *  money can cover the wage and STILL not get the leave approved. */
export const SUBSIDY_NEEDS = [
  { value: 'care', label: 'Care', hint: 'sessions, treatment, someone to help' },
  { value: 'goods', label: 'Goods', hint: 'food, equipment, the material things' },
  { value: 'services', label: 'Services', hint: 'repairs, childcare, transport, trades' },
  { value: 'time_off', label: 'Time off', hint: 'paid room to stop, heal, or care for someone' },
] as const;
export type SubsidyNeed = typeof SUBSIDY_NEEDS[number]['value'];

/** Every line the profile holds, so each can be withheld from AI on its own
 *  (founder 2026-08-20). The help is real — the right intervention for a
 *  diagnosis, a way through a financial hole — so it's available by default
 *  and each line is the member's to hold back. */
export const MEANS_FIELDS = [
  { key: 'monthly_income', label: 'Monthly income' },
  { key: 'monthly_expenses', label: 'Monthly expenses' },
  { key: 'assets', label: 'Assets' },
  { key: 'debt', label: 'Debt' },
  { key: 'income_band', label: 'Household income band' },
  { key: 'household_size', label: 'Household size' },
  { key: 'needs', label: 'What you need' },
  { key: 'obstacles', label: "What's in the way" },
  { key: 'circumstances', label: 'Anything else' },
] as const;
export type MeansField = typeof MEANS_FIELDS[number]['key'];

export interface FinancialPosition {
  profile_id: string;
  income_band: IncomeBand | null;
  household_size: number | null;
  circumstances: string | null;
  /** The loan-application shape, in the words people already know. All
   *  optional — a half-answered profile is still a profile. */
  assets: number | null;
  debt: number | null;
  monthly_income: number | null;
  monthly_expenses: number | null;
  needs: SubsidyNeed[];
  /** Lines held back from every assistant — case by case, the member's call. */
  ai_omit_fields: MeansField[];
  /** What money alone doesn't fix — an employer's leave policy, a lease,
   *  a licence. The part a coordinator actually works through with them. */
  obstacles: string | null;
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
    .select('profile_id, income_band, household_size, circumstances, assets, debt, monthly_income, monthly_expenses, needs, obstacles, ai_omit_fields, care_team_visible, updated_at')
    .eq('profile_id', profileId)
    .maybeSingle();
  if (error) return null;
  return (data as FinancialPosition | null);
}

export async function saveFinancialPosition(
  fields: {
    income_band: IncomeBand | null; household_size: number | null; circumstances: string | null;
    assets?: number | null; debt?: number | null;
    monthly_income?: number | null; monthly_expenses?: number | null;
    needs?: SubsidyNeed[]; obstacles?: string | null; ai_omit_fields?: MeansField[];
  },
): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');
  const { error } = await supabase.from('financial_positions').upsert({
    profile_id: user.id, ...fields, updated_at: new Date().toISOString(),
  });
  if (error) throw error;
}

/** Creating a financial health profile asks the network for a coordinator
 *  (founder 2026-08-20). Bells platform admins, who then OFFER care the
 *  ordinary consensual way — nothing joins a care team by itself. Called
 *  once, when the profile first holds anything. */
export async function requestFinancialCoordinator(): Promise<void> {
  const { error } = await supabase.rpc('request_financial_coordinator');
  if (error) console.warn('requestFinancialCoordinator:', error.message);
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
