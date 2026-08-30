import { supabase } from './supabase';
import type { PageMeta } from '../components/PublicPage';
import type { ContactInfo } from '../components/ContactFields';

/** DRAFT AND PUBLISH (founder 2026-08-29: "i like the draft and publish,
 *  which is what things like squarespace do, let's build it").
 *
 *  The page builder used to hold its work in the browser and write the live
 *  row on Save. Anything unsaved died with the tab, and a stale form could
 *  overwrite an edit Claude had made in the chat. Now the builder writes
 *  here as you type, and the live page only moves when someone publishes.
 *
 *  ⚠ Claude still writes STRAIGHT TO LIVE (founder's call: "you can ask
 *  Claude: revert this change and you can go back" — and the two modes are
 *  meant to feel different, chat as a command, the builder as a canvas). So
 *  a draft can be branched from a version of the page that Claude has since
 *  moved on from. `base` is what it was branched from, and publish compares
 *  it against live before writing — that comparison is the only thing
 *  standing between a draft and someone's lost work. */
export interface PageDraft {
  page: PageMeta;
  description?: string;
  contact?: ContactInfo;
}

export type DraftSubject = 'space' | 'profile';

export interface StoredDraft {
  draft: PageDraft;
  base: PageDraft;
  updatedAt: string;
}

export async function readDraft(type: DraftSubject, id: string): Promise<StoredDraft | null> {
  const { data, error } = await supabase.from('page_drafts')
    .select('draft, base, updated_at')
    .eq('subject_type', type).eq('subject_id', id).maybeSingle();
  if (error || !data) return null;
  const row = data as { draft: PageDraft; base: PageDraft; updated_at: string };
  return { draft: row.draft, base: row.base ?? { page: {} }, updatedAt: row.updated_at };
}

/** Keep the draft. `base` travels with it so publish can tell, later and in
 *  another session, what the page looked like when this draft started. */
export async function writeDraft(
  type: DraftSubject, id: string, draft: PageDraft, base: PageDraft, by?: string,
): Promise<boolean> {
  const { error } = await supabase.from('page_drafts').upsert({
    subject_type: type,
    subject_id: id,
    draft,
    base,
    updated_at: new Date().toISOString(),
    ...(by ? { updated_by: by } : {}),
  }, { onConflict: 'subject_type,subject_id' });
  return !error;
}

/** No unpublished changes left — either published or thrown away. A missing
 *  row IS the "nothing pending" state, so this is called on both paths. */
export async function clearDraft(type: DraftSubject, id: string): Promise<void> {
  await supabase.from('page_drafts')
    .delete().eq('subject_type', type).eq('subject_id', id);
}

/** Same shape, same order, every time — so a draft and the live page can be
 *  compared as strings without a deep-equal library, and a key written in a
 *  different order never reads as a change. */
export function normalize(d: PageDraft): string {
  const sorted = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sorted);
    if (v && typeof v === 'object') {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>)
          .filter(([, val]) => val !== undefined)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, val]) => [k, sorted(val)]),
      );
    }
    return v;
  };
  return JSON.stringify(sorted({
    page: d.page ?? {},
    description: d.description ?? '',
    contact: d.contact ?? {},
  }));
}

export const sameDraft = (a: PageDraft, b: PageDraft): boolean => normalize(a) === normalize(b);

/** ── Version history ──────────────────────────────────────────────────────
 *  Every write to a live page snapshots what it replaced — recorded by a
 *  database trigger, not by the code that writes, so no future write site
 *  can forget. `source` tells you whether a person or the assistant made the
 *  change that this snapshot preceded. */
export interface PageVersion {
  id: string;
  snapshot: PageDraft;
  source: 'builder' | 'assistant';
  createdAt: string;
}

export async function listVersions(
  type: DraftSubject, id: string, limit = 20,
): Promise<PageVersion[]> {
  const { data, error } = await supabase.from('page_versions')
    .select('id, snapshot, source, created_at')
    .eq('subject_type', type).eq('subject_id', id)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error || !data) return [];
  return (data as { id: string; snapshot: PageDraft; source: 'builder' | 'assistant'; created_at: string }[])
    .map((r) => ({ id: r.id, snapshot: r.snapshot, source: r.source, createdAt: r.created_at }));
}

export async function restoreVersion(versionId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('restore_page_version', { p_version: versionId });
  return !error && data === true;
}

/** What changed between two states, in words a person would use. The history
 *  stores states, not diffs — a diff computed on the way out can never drift
 *  from what is actually stored. */
export function describeChange(before: PageDraft, after: PageDraft): string {
  const moved: string[] = [];
  const b = before.page ?? {}; const a = after.page ?? {};
  const named: [keyof PageMeta, string][] = [
    ['tagline', 'the tagline'], ['story', 'the story'], ['homeSummary', 'the home welcome'],
    ['facilities', 'the facilities'], ['accent', 'the colours'], ['surface', 'the background'],
    ['join', 'the Lichen invitation'], ['coverStyle', 'the cover style'], ['cover', 'the cover photo'],
  ];
  for (const [key, label] of named) {
    if (JSON.stringify(b[key]) !== JSON.stringify(a[key])) moved.push(label);
  }
  if (JSON.stringify(b.tabs) !== JSON.stringify(a.tabs)) moved.push('the tabs');
  if (JSON.stringify(b.offerings) !== JSON.stringify(a.offerings)) moved.push('the offerings');
  if (JSON.stringify(b.team) !== JSON.stringify(a.team)) moved.push('the people');
  if (JSON.stringify(b.sections) !== JSON.stringify(a.sections)) moved.push('a section’s photo or line');
  if ((before.description ?? '') !== (after.description ?? '')) moved.push('the description');
  if (JSON.stringify(before.contact ?? {}) !== JSON.stringify(after.contact ?? {})) moved.push('the contact details');
  if (!moved.length) return 'a small change';
  if (moved.length === 1) return moved[0];
  return `${moved.slice(0, -1).join(', ')} and ${moved[moved.length - 1]}`;
}
