import { supabase } from './supabase';
import type { IconName } from '../components/Icon';
import type { RadarAxis } from '../components/HexagonRadar';
import type { Recurrence } from './recurrence';
import { minToLabel } from './calendarApi';
import { youtubeId } from './linkify';

// ─── Wellbeing dimensions — single source of truth (HexagonRadar order) ──────
export const WOW_DIMENSIONS = ['Mental', 'Physical', 'Social', 'Spiritual', 'Environmental', 'Economic'] as const;
export type Dimension = typeof WOW_DIMENSIONS[number];
export const DIMENSION_META: Record<Dimension, IconName> = {
  Mental: 'brain', Physical: 'health', Social: 'user-multiple',
  Spiritual: 'merkaba', Economic: 'dollar', Environmental: 'globe',
};

/** The one banding rule for every WOW score the board shows (founder
 *  2026-09-23): 90+ green, 70–89 peach, below 70 the platform red. */
export type WowBand = 'high' | 'mid' | 'low';
/** What a plan entry points AT, read off its first internal link (founder
 *  2026-09-23, the mock's grammar: "recommends this retreat", an RSVP mark
 *  in the corner). Null = no internal link, the card stays plain. */
export function kocLinkKind(links: CareLink[]): { noun: string; icon: IconName; link: CareLink } | null {
  const l = links.find((x) => x.internal);
  if (!l) return null;
  const p = l.url;
  if (p.startsWith('/events')) return { noun: 'event', icon: 'rsvp', link: l };
  if (p.startsWith('/collections') || p.startsWith('/courses')) return { noun: 'course', icon: 'graduation-cap', link: l };
  if (p.startsWith('/library')) return { noun: 'resource', icon: 'book', link: l };
  if (p.startsWith('/market') || p.startsWith('/posts')) return { noun: 'offering', icon: 'store', link: l };
  return { noun: '', icon: 'arrow-right', link: l };
}

export const wowScoreBand = (v: number): WowBand => (v >= 90 ? 'high' : v >= 70 ? 'mid' : 'low');

export type CareKind = 'wow' | 'koc';
export type MediaKind = 'photo' | 'video' | 'audio';
export interface CareAttachment { type: MediaKind; path: string }
export interface CareLink { label: string; url: string; internal: boolean }
export interface CarePostPreview {
  url: string;
  kind: 'youtube' | 'link';
  videoId?: string;
  title?: string;
  description?: string;
  image?: string;
  siteName?: string;
}

export interface CarePostRow {
  id: string;
  /** The plan entry's headline — the NAME of the thing (founder 2026-09-23,
   *  the mock's grammar: the card leads with the course/retreat/practice).
   *  Null on WOW entries and all pre-title history. */
  title?: string | null;
  /** Set = no assistant reads this entry; the reason shows on the card. */
  ai_omit?: 'medical' | 'financial' | 'other' | null;
  /** How a plan entry is held (founder 2026-09-14): a RECOMMENDED thing is
   *  worth trying, a PRESCRIBED one is part of the plan. Null = unlabeled. */
  intent?: 'recommended' | 'prescribed' | null;
  patient_id: string;
  author_id: string;
  kind: CareKind;
  body: string;
  dimensions: Dimension[];
  score: number | null;
  start_date: string | null;
  end_date: string | null;
  recurrence: Recurrence | null;
  attachments: CareAttachment[];
  links: CareLink[];
  previews: CarePostPreview[];
  created_at: string;
  updated_at: string;
  author?: { full_name: string | null } | null;
}
const CARE_POST_COLS =
  'id, patient_id, author_id, kind, title, body, dimensions, score, start_date, end_date, recurrence, attachments, links, previews, created_at, updated_at, ai_omit, intent';

// ─── Date helpers (parse date-only strings in LOCAL time to avoid tz drift) ──
export function localDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}
export function toISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function todayISO(): string { return toISO(new Date()); }
export function addDays(iso: string, n: number): string {
  const d = localDate(iso); d.setDate(d.getDate() + n); return toISO(d);
}
export function mondayOfWeek(iso: string): string {
  const d = localDate(iso);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // shift back to Monday
  return toISO(d);
}
export function formatDayLabel(iso: string): string {
  const d = localDate(iso);
  return `${d.toLocaleDateString(undefined, { weekday: 'long' })}, ${d.getMonth() + 1}/${d.getDate()}`;
}
export function formatDateShort(iso: string): string {
  const d = localDate(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
export function formatWeekRange(weekStartIso: string): string {
  const a = localDate(weekStartIso);
  const b = new Date(a); b.setDate(a.getDate() + 6);
  const fmt = (d: Date) => `${d.getMonth() + 1}/${d.getDate()}`;
  return `${fmt(a)} – ${fmt(b)}`;
}
/** The mock's week-range grammar (founder 2026-09-23): "Sep 21 – 27",
 *  crossing a month as "Sep 28 – Oct 4". */
export function prettyWeekRange(weekStartIso: string): string {
  const a = localDate(weekStartIso);
  const b = new Date(a); b.setDate(a.getDate() + 6);
  const mon = (d: Date) => d.toLocaleDateString(undefined, { month: 'short' });
  return a.getMonth() === b.getMonth()
    ? `${mon(a)} ${a.getDate()} – ${b.getDate()}`
    : `${mon(a)} ${a.getDate()} – ${mon(b)} ${b.getDate()}`;
}

/** The 7 dates of a Monday-anchored week, with labels. */
export function weekDays(weekStartIso: string): { iso: string; label: string }[] {
  const start = localDate(weekStartIso);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start); d.setDate(start.getDate() + i);
    return { iso: toISO(d), label: formatDayLabel(toISO(d)) };
  });
}
/** A KOC post's own span, as a short label ("Mon 6/2" or "6/2 – 6/4"). */
export function rangeLabel(startIso: string, endIso: string): string {
  return startIso === endIso ? formatDateShort(startIso) : `${formatDateShort(startIso)} – ${formatDateShort(endIso)}`;
}

// ─── Load ────────────────────────────────────────────────────────────────────
export interface LoadOpts { dimension?: Dimension | 'All'; from?: string; to?: string }

export async function loadCarePosts(patientId: string, kind: CareKind, opts: LoadOpts = {}): Promise<CarePostRow[]> {
  let q = supabase
    .from('care_posts')
    .select(`${CARE_POST_COLS}, author:profiles!care_posts_author_id_fkey(full_name)`)
    .eq('patient_id', patientId)
    .eq('kind', kind);
  if (kind === 'koc' && opts.from && opts.to) {
    // A post is a candidate for the window if it starts on/before it AND either
    // ends on/after it OR is open-ended (recurring). The client then decides each
    // day precisely via occursOn() (recurrence.ts).
    q = q.lte('start_date', opts.to)
      .or(`end_date.gte.${opts.from},end_date.is.null`)
      .order('start_date').order('created_at');
  } else {
    if (kind === 'wow' && opts.dimension && opts.dimension !== 'All') q = q.contains('dimensions', [opts.dimension]);
    q = q.order('created_at', { ascending: false });
  }
  const { data } = await q;
  return (data as unknown as CarePostRow[] | null) ?? [];
}

/** One entry by id — the "?ask=" landing when the board state doesn't hold it
 *  (a KOC entry from another week, a reloaded URL). RLS scopes to parties. */
export async function loadCarePost(id: string): Promise<CarePostRow | null> {
  const { data } = await supabase
    .from('care_posts')
    .select(`${CARE_POST_COLS}, author:profiles!care_posts_author_id_fkey(full_name)`)
    .eq('id', id)
    .maybeSingle();
  return (data as unknown as CarePostRow | null) ?? null;
}

/** Which dimensions the member has ALREADY spoken to in their own voice —
 *  the guided intake (founder 2026-09-11, onboarding Mark's cohort) lands on
 *  the first unanswered one and never re-asks what's been given. */
export async function myAnsweredWowDimensions(me: string): Promise<Set<Dimension>> {
  const { data } = await supabase
    .from('care_posts')
    .select('dimensions')
    .eq('patient_id', me).eq('author_id', me).eq('kind', 'wow');
  const out = new Set<Dimension>();
  for (const r of (data as { dimensions: Dimension[] }[] | null) ?? []) {
    for (const d of r.dimensions ?? []) out.add(d);
  }
  return out;
}

/** The member's own woven WOW entries, grouped per dimension, newest first —
 *  what the guided intake hydrates an already-answered step FROM (founder
 *  2026-09-22: green checkmarks against empty fields read as lost work; the
 *  words and scores must come back, in their own bubbles). Scoped to ONE
 *  assessment (`assessmentId`), or `null` for pre-assessment (ungrouped)
 *  entries — the adoption pool. An "All" entry (empty dimensions) is a
 *  board-level update, not a thread answer, so it stays out of this map. */
export interface WovenWowEntry { id: string; body: string; score: number | null; ai_omit: string | null; dimensions: Dimension[]; created_at: string }
export async function myWovenWowEntries(me: string, assessmentId: string | null): Promise<Partial<Record<Dimension, WovenWowEntry[]>>> {
  let q = supabase
    .from('care_posts')
    .select('id, body, score, ai_omit, dimensions, created_at')
    .eq('patient_id', me).eq('author_id', me).eq('kind', 'wow');
  q = assessmentId ? q.eq('assessment_id', assessmentId) : q.is('assessment_id', null);
  const { data } = await q.order('created_at', { ascending: false }).limit(200);
  const out: Partial<Record<Dimension, WovenWowEntry[]>> = {};
  for (const r of (data as WovenWowEntry[] | null) ?? []) {
    for (const d of r.dimensions ?? []) {
      if (!(WOW_DIMENSIONS as readonly string[]).includes(d)) continue;
      (out[d] ??= []).push(r);
    }
  }
  return out;
}

// ─── Assessments (founder 2026-09-22: editable until SUBMITTED, one score per
//     category per assessment, timestamped on submit for assessments-over-time) ──
export async function myOpenAssessment(me: string): Promise<string | null> {
  const { data } = await supabase.from('wow_assessments').select('id')
    .eq('profile_id', me).is('submitted_at', null).maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}
export async function ensureOpenAssessment(me: string): Promise<string> {
  const open = await myOpenAssessment(me);
  if (open) return open;
  const { data, error } = await supabase.from('wow_assessments')
    .insert({ profile_id: me }).select('id').single();
  if (error) {
    // Lost a race against ourselves — the partial unique index means the
    // open row now exists; read it instead of failing the weave.
    const again = await myOpenAssessment(me);
    if (again) return again;
    throw error;
  }
  return (data as { id: string }).id;
}
export async function submitAssessment(id: string): Promise<void> {
  const { error } = await supabase.from('wow_assessments')
    .update({ submitted_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
}
/** Fold a pre-assessment entry into an assessment (the one-time adoption
 *  when the feature arrives mid-intake); `score` optionally consolidates a
 *  newer score-only duplicate's number into the substantive entry. */
export async function adoptWowEntry(id: string, assessmentId: string, score?: number | null): Promise<void> {
  const patch: Record<string, unknown> = { assessment_id: assessmentId };
  if (score !== undefined) patch.score = score;
  const { error } = await supabase.from('care_posts').update(patch).eq('id', id);
  if (error) throw error;
}

// ─── Derived WOW radar ───────────────────────────────────────────────────────
export interface WowScores { byDimension: Record<Dimension, number | null>; overall: number | null }

/** Category score = your CURRENT state, not a lifetime average (founder asked
 *  2026-08-14 "should your score be the running average of your entries?" —
 *  answer: recent entries only. A running average makes the score a GPA: one
 *  hard year drags the number forever, and getting better barely moves it.
 *  Wellbeing is a now-reading): each dimension averages its entries from the
 *  last 60 days — yours and your care team's counting equally — and a
 *  dimension quiet longer than that carries its single latest entry forward
 *  rather than blanking. An "All" post (empty dimensions) counts toward every
 *  dimension. Overall WOW = avg of the six currents. History stays in the
 *  feed, so a trend view can come later without changing what's stored. */
// 60, not 30 or 90 (founder 2026-08-14): short enough to feel alive for
// someone changing fast, wide enough that one rough entry doesn't own the
// number. People who post rarely are untouched by the window either way —
// their latest entry carries forward regardless of age.
export const WOW_WINDOW_DEFAULT = 60;
export function computeWowScores(posts: CarePostRow[], now = new Date(), windowDays = WOW_WINDOW_DEFAULT): WowScores {
  const cutoff = new Date(now.getTime() - windowDays * 86400_000).toISOString();
  const recent: Record<string, number[]> = {};
  const latest: Record<string, { at: string; score: number }> = {};
  for (const d of WOW_DIMENSIONS) recent[d] = [];
  for (const p of posts) {
    if (p.kind !== 'wow' || p.score == null) continue;
    const targets = p.dimensions.length ? p.dimensions : WOW_DIMENSIONS;
    for (const d of targets) {
      if (!(d in recent)) continue;
      if (p.created_at >= cutoff) recent[d].push(p.score);
      if (!latest[d] || p.created_at > latest[d].at) latest[d] = { at: p.created_at, score: p.score };
    }
  }
  const byDimension = {} as Record<Dimension, number | null>;
  let oSum = 0, oCnt = 0;
  for (const d of WOW_DIMENSIONS) {
    const rs = recent[d];
    const v = rs.length
      ? Math.round(rs.reduce((a, b) => a + b, 0) / rs.length)
      : (latest[d]?.score ?? null);
    byDimension[d] = v;
    if (v != null) { oSum += v; oCnt += 1; }
  }
  return { byDimension, overall: oCnt ? Math.round(oSum / oCnt) : null };
}

/** THREE WOW LENSES (founder 2026-09-21: "Self Assessment, Care Team
 *  Assessment, Self + Care Team Assessment … helpful and interesting to see
 *  how differently we assess ourselves than our care team"). The combo is
 *  50/50 BY SIDE, never by entry count — six caregivers with 25 entries and
 *  one person with 6 still meet in the middle: half your reflection, half
 *  your care team's. A dimension only one side has spoken to carries that
 *  side's reading (half of silence isn't a lower score). */
export type WowLens = 'self' | 'team' | 'combo';
export function computeWowLenses(
  posts: CarePostRow[], patientId: string, now = new Date(), windowDays = WOW_WINDOW_DEFAULT,
): Record<WowLens, WowScores> {
  const self = computeWowScores(posts.filter((p) => p.author_id === patientId), now, windowDays);
  const team = computeWowScores(posts.filter((p) => p.author_id !== patientId), now, windowDays);
  const byDimension = {} as Record<Dimension, number | null>;
  let oSum = 0, oCnt = 0;
  for (const d of WOW_DIMENSIONS) {
    const s = self.byDimension[d], t = team.byDimension[d];
    const v = s != null && t != null ? Math.round((s + t) / 2) : (s ?? t);
    byDimension[d] = v;
    if (v != null) { oSum += v; oCnt += 1; }
  }
  return { self, team, combo: { byDimension, overall: oCnt ? Math.round(oSum / oCnt) : null } };
}

// ─── The self-driving window (founder 2026-08-14) ────────────────────────────
// A member may hand their score window to Claude — opt-in, visible, revocable
// ("kinda like self driving cars"). care_settings holds the consent and
// Claude's current pick + reason; the wow-window edge function does the
// tuning (throttled server-side to once a week).

export interface CareSettings {
  wow_window_days: number | null;
  wow_window_auto: boolean;
  wow_window_reason: string | null;
  wow_window_set_at: string | null;
}

export async function getCareSettings(patientId: string): Promise<CareSettings | null> {
  const { data, error } = await supabase.from('care_settings')
    .select('wow_window_days, wow_window_auto, wow_window_reason, wow_window_set_at')
    .eq('patient_id', patientId).maybeSingle();
  if (error) { console.warn('getCareSettings:', error.message); return null; }
  return (data as CareSettings | null);
}

/** Flip the consent switch — your own row only (RLS). */
export async function setWowWindowAuto(me: string, on: boolean): Promise<void> {
  const { error } = await supabase.from('care_settings')
    .upsert({ patient_id: me, wow_window_auto: on, updated_at: new Date().toISOString() });
  if (error) throw error;
}

/** Ask Claude to (re)tune your window. Server-side it requires the consent
 *  switch on, and returns the standing choice untouched if tuned <7 days ago. */
export async function tuneWowWindow(): Promise<{ days: number; reason: string } | null> {
  const { data, error } = await supabase.functions.invoke('wow-window', { body: {} });
  if (error) { console.warn('tuneWowWindow:', error.message); return null; }
  return (data as { days?: number; reason?: string } | null)?.days
    ? { days: (data as { days: number }).days, reason: (data as { reason?: string }).reason ?? '' }
    : null;
}

/** Build HexagonRadar axes from derived scores (null = no entries yet → "—"). */
export function wowAxes(byDimension: Record<Dimension, number | null>): RadarAxis[] {
  return WOW_DIMENSIONS.map((d) => ({ label: d, icon: DIMENSION_META[d], value: byDimension[d] }));
}

// ─── Create / delete ─────────────────────────────────────────────────────────
export interface CarePostInput {
  title?: string | null;
  patientId: string; kind: CareKind; body: string;
  dimensions?: Dimension[]; score?: number;      // wow
  startDate?: string; endDate?: string;          // koc
  recurrence?: Recurrence | null;                // koc (null = plain day/range)
  attachments: CareAttachment[]; links: CareLink[]; previews: CarePostPreview[];
  /** 'medical' | 'financial' | 'other' — held back from every assistant,
   *  chosen when writing (founder 2026-08-20). Absent = Claude may help. */
  aiOmit?: 'medical' | 'financial' | 'other' | null;
  /** koc only: recommended vs prescribed (founder 2026-09-14). */
  intent?: 'recommended' | 'prescribed' | null;
  /** wow only: the open assessment this entry belongs to (founder 2026-09-22). */
  assessmentId?: string | null;
}
export async function createCarePost(me: string, input: CarePostInput): Promise<string> {
  const recurring = input.kind === 'koc' && !!input.recurrence;
  const row = {
    patient_id: input.patientId, author_id: me, kind: input.kind, body: input.body,
    title: input.kind === 'koc' ? (input.title?.trim() || null) : null,
    dimensions: input.kind === 'wow' ? (input.dimensions ?? []) : [],
    score: input.kind === 'wow' ? input.score : null,
    start_date: input.kind === 'koc' ? input.startDate : null,
    // A recurring post's end lives in the recurrence spec, so end_date is null.
    end_date: input.kind === 'koc' && !recurring ? input.endDate : null,
    recurrence: input.kind === 'koc' ? (input.recurrence ?? null) : null,
    attachments: input.attachments, links: input.links, previews: input.previews,
    // Per-entry AI omission with its reason (founder 2026-08-20).
    ai_omit: input.aiOmit ?? null,
    // How a plan entry is held (founder 2026-09-14) — plan items only.
    intent: input.kind === 'koc' ? (input.intent ?? null) : null,
    // The assessment an intake entry belongs to (founder 2026-09-22).
    assessment_id: input.kind === 'wow' ? (input.assessmentId ?? null) : null,
  };
  const { data, error } = await supabase.from('care_posts').insert(row).select('id').single();
  if (error) throw error;
  return (data as { id: string }).id;
}
export async function deleteCarePost(id: string): Promise<void> {
  const { error } = await supabase.from('care_posts').delete().eq('id', id);
  if (error) throw error;
}

/** Edit one of your OWN wow entries in place (founder 2026-09-22: a saved
 *  intake answer clicks into edit mode and saving updates it — no duplicate
 *  entry). RLS's self-arm (author = patient = you) is what allows this. */
export async function updateWowCarePost(
  id: string,
  patch: { body: string; score: number | null; aiOmit: 'medical' | 'financial' | 'other' | null },
): Promise<void> {
  const { error } = await supabase.from('care_posts')
    .update({ body: patch.body, score: patch.score, ai_omit: patch.aiOmit, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

// ─── Media (private care-media bucket, paths signed at render) ────────────────
export async function uploadCareMedia(patientId: string, file: Blob, ext: string): Promise<string> {
  const path = `${patientId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const { error } = await supabase.storage.from('care-media').upload(path, file);
  if (error) throw error;
  return path;
}
export async function signCareMedia(paths: string[]): Promise<Record<string, string>> {
  const unique = [...new Set(paths)].filter(Boolean);
  if (unique.length === 0) return {};
  const { data, error } = await supabase.storage.from('care-media').createSignedUrls(unique, 3600);
  if (error || !data) return {};
  const map: Record<string, string> = {};
  for (const r of data) if (r.path && r.signedUrl) map[r.path] = r.signedUrl;
  return map;
}

/** internal iff an in-app path ("/…") but not protocol-relative ("//host"). */
export function isInternalUrl(url: string): boolean {
  return url.startsWith('/') && !url.startsWith('//');
}

// ─── On-call roster (Urgent tab) ──────────────────────────────────────────────
// Windows are weekly on-call hours (kind='on_call' in availability_windows),
// interpreted in the VIEWER's local clock — same convention as the whole
// calendar (start_min/end_min carry no timezone).
export interface OnCallWindow {
  id: string;
  weekday: number;              // 0=Mon … 6=Sun (recurrence.ts convention)
  start_min: number;
  end_min: number;
  valid_from: string | null;
  valid_to: string | null;
}
export interface OnCallCaregiver {
  id: string;
  name: string;
  headline: string | null;
  avatarUrl: string | null;
  phone: string | null;
  windows: OnCallWindow[];
}

interface RosterRow {
  caregiver_id: string; full_name: string | null; headline: string | null;
  avatar_url: string | null; phone: string | null;
  window_id: string | null; weekday: number | null; start_min: number | null;
  end_min: number | null; valid_from: string | null; valid_to: string | null;
}

/** The patient's active caregivers + their on-call windows (on_call_roster RPC;
 *  callable by the patient or any of their active caregivers). */
export async function loadOnCallRoster(patientId: string): Promise<OnCallCaregiver[]> {
  const { data, error } = await supabase.rpc('on_call_roster', { p_patient: patientId });
  if (error) { console.warn('on_call_roster:', error.message); return []; }
  const byId = new Map<string, OnCallCaregiver>();
  for (const r of (data as RosterRow[] | null) ?? []) {
    let c = byId.get(r.caregiver_id);
    if (!c) {
      c = {
        id: r.caregiver_id, name: r.full_name || 'Member', headline: r.headline,
        avatarUrl: r.avatar_url, phone: r.phone, windows: [],
      };
      byId.set(r.caregiver_id, c);
    }
    if (r.window_id != null) {
      c.windows.push({
        id: r.window_id, weekday: r.weekday!, start_min: r.start_min!, end_min: r.end_min!,
        valid_from: r.valid_from, valid_to: r.valid_to,
      });
    }
  }
  return [...byId.values()];
}

function weekdayMon0(iso: string): number { return (localDate(iso).getDay() + 6) % 7; }
function coversDate(w: OnCallWindow, iso: string): boolean {
  return weekdayMon0(iso) === w.weekday
    && (w.valid_from == null || iso >= w.valid_from)
    && (w.valid_to == null || iso <= w.valid_to);
}

/** The window covering `nowMin` on `iso`, if any (latest-ending wins so the
 *  primary pick is deterministic when shifts overlap). */
export function onCallNow(windows: OnCallWindow[], iso: string, nowMin: number): OnCallWindow | null {
  let best: OnCallWindow | null = null;
  for (const w of windows) {
    if (!coversDate(w, iso) || w.start_min > nowMin || nowMin >= w.end_min) continue;
    if (!best || w.end_min > best.end_min) best = w;
  }
  return best;
}

/** The next upcoming on-call start within 14 days (later today counts). */
export function nextOnCall(
  windows: OnCallWindow[], fromIso: string, nowMin: number,
): { iso: string; startMin: number } | null {
  const start = localDate(fromIso);
  for (let i = 0; i < 14; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    const iso = toISO(d);
    const starts = windows
      .filter((w) => coversDate(w, iso) && (i > 0 || w.start_min > nowMin))
      .map((w) => w.start_min);
    if (starts.length) return { iso, startMin: Math.min(...starts) };
  }
  return null;
}

/** "On call today 3pm" / "On call Tue 9am" / "No on-call hours set". */
export function nextOnCallLabel(next: { iso: string; startMin: number } | null): string {
  if (!next) return 'No on-call hours set';
  const day = next.iso === todayISO()
    ? 'today'
    : localDate(next.iso).toLocaleDateString(undefined, { weekday: 'short' });
  return `On call ${day} ${minToLabel(next.startMin)}`;
}

/** Own phone number (profiles.phone has no SELECT grant — read via RPC). */
export async function loadMyPhone(): Promise<string> {
  const { data, error } = await supabase.rpc('my_phone');
  if (error) { console.warn('my_phone:', error.message); return ''; }
  return (data as string | null) ?? '';
}

/** Resolve body URLs to rich previews at compose time (YouTube parsed locally;
 *  others via the link-preview edge function). Capped; failures degrade to a
 *  bare { url } so the body's inline link still works. */
export async function resolvePreviews(urls: string[]): Promise<CarePostPreview[]> {
  const out: CarePostPreview[] = [];
  for (const url of urls.slice(0, 3)) {
    const vid = youtubeId(url);
    if (vid) { out.push({ url, kind: 'youtube', videoId: vid }); continue; }
    try {
      const { data } = await supabase.functions.invoke('link-preview', { body: { url } });
      const d = (data ?? {}) as Partial<CarePostPreview>;
      out.push({ url, kind: 'link', title: d.title, description: d.description, image: d.image, siteName: d.siteName });
    } catch {
      out.push({ url, kind: 'link' });
    }
  }
  return out;
}
