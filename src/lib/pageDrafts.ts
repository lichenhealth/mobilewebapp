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
