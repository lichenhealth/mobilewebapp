import { supabase } from './supabase';
import type { IconName } from '../components/Icon';
import type { RadarAxis } from '../components/HexagonRadar';
import { youtubeId } from './linkify';

// ─── Wellbeing dimensions — single source of truth (HexagonRadar order) ──────
export const WOW_DIMENSIONS = ['Mental', 'Physical', 'Social', 'Spiritual', 'Economic', 'Environmental'] as const;
export type Dimension = typeof WOW_DIMENSIONS[number];
export const DIMENSION_META: Record<Dimension, IconName> = {
  Mental: 'brain', Physical: 'health', Social: 'user-multiple',
  Spiritual: 'leaf', Economic: 'dollar', Environmental: 'globe',
};

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
  patient_id: string;
  author_id: string;
  kind: CareKind;
  body: string;
  dimensions: Dimension[];
  score: number | null;
  start_date: string | null;
  end_date: string | null;
  attachments: CareAttachment[];
  links: CareLink[];
  previews: CarePostPreview[];
  created_at: string;
  updated_at: string;
  author?: { full_name: string | null } | null;
}
const CARE_POST_COLS =
  'id, patient_id, author_id, kind, body, dimensions, score, start_date, end_date, attachments, links, previews, created_at, updated_at';

// ─── Date helpers (parse date-only strings in LOCAL time to avoid tz drift) ──
export function localDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}
export function toISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function todayISO(): string { return toISO(new Date()); }
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
    // Overlap: a post is visible in the window if its span intersects it.
    q = q.lte('start_date', opts.to).gte('end_date', opts.from).order('start_date').order('created_at');
  } else {
    if (kind === 'wow' && opts.dimension && opts.dimension !== 'All') q = q.contains('dimensions', [opts.dimension]);
    q = q.order('created_at', { ascending: false });
  }
  const { data } = await q;
  return (data as unknown as CarePostRow[] | null) ?? [];
}

// ─── Derived WOW radar ───────────────────────────────────────────────────────
export interface WowScores { byDimension: Record<Dimension, number | null>; overall: number | null }

/** Category score = avg of the scores of posts tagged with it; an "All" post
 *  (empty dimensions) counts toward every dimension. Overall = avg of categories. */
export function computeWowScores(posts: CarePostRow[]): WowScores {
  const sum: Record<string, number> = {};
  const cnt: Record<string, number> = {};
  for (const d of WOW_DIMENSIONS) { sum[d] = 0; cnt[d] = 0; }
  for (const p of posts) {
    if (p.kind !== 'wow' || p.score == null) continue;
    const targets = p.dimensions.length ? p.dimensions : WOW_DIMENSIONS;
    for (const d of targets) if (d in sum) { sum[d] += p.score; cnt[d] += 1; }
  }
  const byDimension = {} as Record<Dimension, number | null>;
  let oSum = 0, oCnt = 0;
  for (const d of WOW_DIMENSIONS) {
    const v = cnt[d] ? Math.round(sum[d] / cnt[d]) : null;
    byDimension[d] = v;
    if (v != null) { oSum += v; oCnt += 1; }
  }
  return { byDimension, overall: oCnt ? Math.round(oSum / oCnt) : null };
}

/** Build HexagonRadar axes from derived scores (null = no entries yet → "—"). */
export function wowAxes(byDimension: Record<Dimension, number | null>): RadarAxis[] {
  return WOW_DIMENSIONS.map((d) => ({ label: d, icon: DIMENSION_META[d], value: byDimension[d] }));
}

// ─── Create / delete ─────────────────────────────────────────────────────────
export interface CarePostInput {
  patientId: string; kind: CareKind; body: string;
  dimensions?: Dimension[]; score?: number;      // wow
  startDate?: string; endDate?: string;          // koc
  attachments: CareAttachment[]; links: CareLink[]; previews: CarePostPreview[];
}
export async function createCarePost(me: string, input: CarePostInput): Promise<string> {
  const row = {
    patient_id: input.patientId, author_id: me, kind: input.kind, body: input.body,
    dimensions: input.kind === 'wow' ? (input.dimensions ?? []) : [],
    score: input.kind === 'wow' ? input.score : null,
    start_date: input.kind === 'koc' ? input.startDate : null,
    end_date: input.kind === 'koc' ? input.endDate : null,
    attachments: input.attachments, links: input.links, previews: input.previews,
  };
  const { data, error } = await supabase.from('care_posts').insert(row).select('id').single();
  if (error) throw error;
  return (data as { id: string }).id;
}
export async function deleteCarePost(id: string): Promise<void> {
  const { error } = await supabase.from('care_posts').delete().eq('id', id);
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
