import { supabase } from './supabase';
import { colorFor, monogramFor } from './chatApi';
import type { IconName } from '../components/Icon';
import type { HealthSnapshot, CarePlan, CarePlanDay, SnapshotSection } from '../data/concierge';

// ─── Canonical wellness axes — the SINGLE source of truth ────────────────────
// AXIS_ORDER is HexagonRadar's positional order (top, then clockwise). Scores are
// keyed by axis NAME everywhere; `rowToAxes` is the only place order is applied.
export const AXIS_ORDER = ['Mental', 'Financial', 'Social', 'Spirit', 'Physical', 'Emotional'] as const;
export type AxisName = typeof AXIS_ORDER[number];
export type AxisScores = Record<AxisName, number>;

export const AXIS_META: Record<AxisName, IconName> = {
  Mental: 'brain', Financial: 'dollar', Social: 'user-multiple',
  Spirit: 'leaf', Physical: 'health', Emotional: 'smile',
};
const AXIS_COL: Record<AxisName, keyof SnapshotRow> = {
  Mental: 'score_mental', Financial: 'score_financial', Social: 'score_social',
  Spirit: 'score_spirit', Physical: 'score_physical', Emotional: 'score_emotional',
};

// ─── Rows ────────────────────────────────────────────────────────────────────
export interface SnapshotRow {
  id: string;
  patient_id: string;
  author_id: string;
  snapshot_date: string;   // 'YYYY-MM-DD'
  summary: string;
  score_mental: number;
  score_physical: number;
  score_emotional: number;
  score_social: number;
  score_financial: number;
  score_spirit: number;
  sections: SnapshotSection[];
  patient?: { full_name: string | null } | null;
}
const SNAPSHOT_COLS =
  'id, patient_id, author_id, snapshot_date, summary, score_mental, score_physical, score_emotional, score_social, score_financial, score_spirit, sections';

interface PlanRow {
  id: string; patient_id: string; author_id: string; week_start: string;
  patient?: { full_name: string | null } | null;
}
interface PlanItemRow {
  id: string; plan_id: string; is_daily: boolean; item_date: string | null;
  provider_id: string | null; provider_label: string | null; body: string; sort: number;
}

export interface CareTeamProvider { id: string; name: string; handle: string }

// ─── Date helpers (parse date-only strings in LOCAL time to avoid tz drift) ──
function localDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}
export function formatSnapshotDate(iso: string): string {
  const d = localDate(iso);
  const wd = d.toLocaleDateString(undefined, { weekday: 'short' });
  return `${wd}, ${d.getMonth() + 1}/${d.getDate()}`;
}
export function formatDayLabel(iso: string): string {
  const d = localDate(iso);
  const wd = d.toLocaleDateString(undefined, { weekday: 'long' });
  return `${wd}, ${d.getMonth() + 1}/${d.getDate()}`;
}
export function formatWeekRange(weekStartIso: string): string {
  const a = localDate(weekStartIso);
  const b = new Date(a); b.setDate(a.getDate() + 6);
  const fmt = (d: Date) => `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(2)}`;
  return `${fmt(a)} – ${fmt(b)}`;
}
function toISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function todayISO(): string { return toISO(new Date()); }
export function mondayOfWeek(iso: string): string {
  const d = localDate(iso);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // shift back to Monday
  return toISO(d);
}
/** The 7 dates of a Monday-anchored week, with display labels — for the plan editor. */
export function weekDays(weekStartIso: string): { iso: string; label: string }[] {
  const start = localDate(weekStartIso);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start); d.setDate(start.getDate() + i);
    return { iso: toISO(d), label: `${d.toLocaleDateString(undefined, { weekday: 'long' })}, ${d.getMonth() + 1}/${d.getDate()}` };
  });
}

/** Build the HexagonRadar-ordered axes array — the ONLY place axis order applies. */
function rowToAxes(r: SnapshotRow) {
  return AXIS_ORDER.map((name) => ({ label: name, icon: AXIS_META[name], value: Number(r[AXIS_COL[name]]) }));
}

function patientVM(id: string, name: string | null) {
  const n = name ?? 'Member';
  return { name: n, monogram: monogramFor(n), color: colorFor(id) };
}

// ─── WOW: load ───────────────────────────────────────────────────────────────
export async function loadLatestSnapshot(patientId: string): Promise<{ row: SnapshotRow; vm: HealthSnapshot } | null> {
  const { data } = await supabase
    .from('health_snapshots')
    .select(`${SNAPSHOT_COLS}, patient:profiles!health_snapshots_patient_id_fkey(full_name)`)
    .eq('patient_id', patientId)
    .order('snapshot_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  const row = data as unknown as SnapshotRow;
  const vm: HealthSnapshot = {
    date: formatSnapshotDate(row.snapshot_date),
    patient: patientVM(row.patient_id, row.patient?.full_name ?? null),
    summary: row.summary,
    axes: rowToAxes(row),
    sections: row.sections ?? [],
  };
  return { row, vm };
}

// ─── KOC: load ───────────────────────────────────────────────────────────────
export async function loadCurrentCarePlan(patientId: string): Promise<{ plan: PlanRow; vm: CarePlan } | null> {
  const { data: planData } = await supabase
    .from('care_plans')
    .select('id, patient_id, author_id, week_start, patient:profiles!care_plans_patient_id_fkey(full_name)')
    .eq('patient_id', patientId)
    .order('week_start', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!planData) return null;
  const plan = planData as unknown as PlanRow;

  const { data: itemData } = await supabase
    .from('care_plan_items')
    .select('id, plan_id, is_daily, item_date, provider_id, provider_label, body, sort')
    .eq('plan_id', plan.id)
    .order('is_daily', { ascending: false })
    .order('item_date', { ascending: true })
    .order('sort', { ascending: true });
  const items = (itemData as PlanItemRow[] | null) ?? [];

  // Resolve provider display handles.
  const providerIds = [...new Set(items.map((i) => i.provider_id).filter(Boolean))] as string[];
  const handleById = new Map<string, string>();
  if (providerIds.length) {
    const { data: profs } = await supabase.from('profiles').select('id, full_name, handle').in('id', providerIds);
    for (const p of (profs as { id: string; full_name: string | null; handle: string | null }[] | null) ?? []) {
      handleById.set(p.id, '@' + (p.handle || (p.full_name ?? 'member').replace(/\s+/g, '')));
    }
  }
  const displayHandle = (i: PlanItemRow) =>
    (i.provider_id && handleById.get(i.provider_id)) || i.provider_label || '@provider';

  // Group: day → provider → items, preserving the query order (Daily first, then by date/sort).
  const days: CarePlanDay[] = [];
  const dayIndex = new Map<string, number>();      // dayKey → index in `days`
  for (const it of items) {
    const dayKey = it.is_daily ? 'daily' : (it.item_date ?? '');
    const label = it.is_daily ? 'Daily' : formatDayLabel(it.item_date!);
    if (!dayIndex.has(dayKey)) { dayIndex.set(dayKey, days.length); days.push({ label, providers: [] }); }
    const day = days[dayIndex.get(dayKey)!];
    const handle = displayHandle(it);
    let prov = day.providers.find((p) => p.handle === handle);
    if (!prov) { prov = { handle, items: [] }; day.providers.push(prov); }
    prov.items.push({ text: it.body });
  }

  const vm: CarePlan = {
    dateRange: formatWeekRange(plan.week_start),
    patient: patientVM(plan.patient_id, plan.patient?.full_name ?? null),
    days,
  };
  return { plan, vm };
}

/** Active caregivers of a patient — the provider dropdown for the plan editor. */
export async function loadCareTeam(patientId: string): Promise<CareTeamProvider[]> {
  const { data } = await supabase
    .from('care_team_members')
    .select('caregiver_id, caregiver:profiles!care_team_members_caregiver_id_fkey(full_name, handle)')
    .eq('patient_id', patientId)
    .eq('status', 'active');
  return ((data as { caregiver_id: string; caregiver: { full_name: string | null; handle: string | null } | null }[] | null) ?? [])
    .map((r) => ({
      id: r.caregiver_id,
      name: r.caregiver?.full_name ?? 'Member',
      handle: '@' + (r.caregiver?.handle || (r.caregiver?.full_name ?? 'member').replace(/\s+/g, '')),
    }));
}

// ─── Authoring (CRUD) ────────────────────────────────────────────────────────
export interface SnapshotInput {
  patientId: string; snapshotDate: string; summary: string;
  scores: AxisScores; sections: SnapshotSection[];
}
export async function upsertSnapshot(me: string, input: SnapshotInput): Promise<string> {
  const row = {
    patient_id: input.patientId, author_id: me, snapshot_date: input.snapshotDate, summary: input.summary,
    score_mental: input.scores.Mental, score_physical: input.scores.Physical, score_emotional: input.scores.Emotional,
    score_social: input.scores.Social, score_financial: input.scores.Financial, score_spirit: input.scores.Spirit,
    sections: input.sections,
  };
  const { data, error } = await supabase
    .from('health_snapshots')
    .upsert(row, { onConflict: 'patient_id,snapshot_date' })
    .select('id').single();
  if (error) throw error;
  return (data as { id: string }).id;
}
export async function deleteSnapshot(id: string): Promise<void> {
  const { error } = await supabase.from('health_snapshots').delete().eq('id', id);
  if (error) throw error;
}

export interface PlanItemInput {
  isDaily: boolean; itemDate: string | null;
  providerId: string | null; providerLabel: string | null; body: string; sort: number;
}
export async function upsertCarePlan(me: string, patientId: string, weekStart: string): Promise<string> {
  const { data, error } = await supabase
    .from('care_plans')
    .upsert({ patient_id: patientId, author_id: me, week_start: weekStart }, { onConflict: 'patient_id,week_start' })
    .select('id').single();
  if (error) throw error;
  return (data as { id: string }).id;
}
/** Replace all items for a plan (delete-then-insert — simplest correct write). */
export async function replacePlanItems(planId: string, items: PlanItemInput[]): Promise<void> {
  const del = await supabase.from('care_plan_items').delete().eq('plan_id', planId);
  if (del.error) throw del.error;
  const rows = items
    .filter((i) => i.body.trim())
    .map((i) => ({
      plan_id: planId, is_daily: i.isDaily, item_date: i.isDaily ? null : i.itemDate,
      provider_id: i.providerId, provider_label: i.providerId ? null : i.providerLabel, body: i.body, sort: i.sort,
    }));
  if (rows.length) {
    const ins = await supabase.from('care_plan_items').insert(rows);
    if (ins.error) throw ins.error;
  }
}
export async function deleteCarePlan(id: string): Promise<void> {
  const { error } = await supabase.from('care_plans').delete().eq('id', id);
  if (error) throw error;
}

// ─── Editor prefills ─────────────────────────────────────────────────────────
export interface PlanForEdit { planId: string | null; weekStart: string; items: PlanItemInput[] }
/** Latest plan + its raw items (provider_id preserved) for the care-plan editor. */
export async function loadCarePlanForEdit(patientId: string): Promise<PlanForEdit> {
  const { data: planData } = await supabase
    .from('care_plans').select('id, week_start')
    .eq('patient_id', patientId).order('week_start', { ascending: false }).limit(1).maybeSingle();
  const plan = planData as { id: string; week_start: string } | null;
  if (!plan) return { planId: null, weekStart: mondayOfWeek(todayISO()), items: [] };
  const { data: itemData } = await supabase
    .from('care_plan_items')
    .select('is_daily, item_date, provider_id, provider_label, body, sort')
    .eq('plan_id', plan.id).order('is_daily', { ascending: false }).order('item_date').order('sort');
  const items = ((itemData as PlanItemRow[] | null) ?? []).map((r) => ({
    isDaily: r.is_daily, itemDate: r.item_date, providerId: r.provider_id,
    providerLabel: r.provider_label, body: r.body, sort: r.sort,
  }));
  return { planId: plan.id, weekStart: plan.week_start, items };
}

/** Latest snapshot's editable fields (scores keyed by axis name) for the WOW editor. */
export interface SnapshotForEdit {
  snapshotDate: string; summary: string; scores: AxisScores; sections: SnapshotSection[];
}
export async function loadSnapshotForEdit(patientId: string): Promise<SnapshotForEdit | null> {
  const { data } = await supabase
    .from('health_snapshots').select(SNAPSHOT_COLS)
    .eq('patient_id', patientId).order('snapshot_date', { ascending: false })
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (!data) return null;
  const r = data as unknown as SnapshotRow;
  const scores = AXIS_ORDER.reduce((acc, name) => {
    acc[name] = Number(r[AXIS_COL[name]]); return acc;
  }, {} as AxisScores);
  return { snapshotDate: r.snapshot_date, summary: r.summary, scores, sections: r.sections ?? [] };
}
