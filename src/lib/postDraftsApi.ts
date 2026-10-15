import { supabase } from './supabase';

/** POST DRAFTS (founder 2026-10-15: "can we have posts auto save and have a
 *  save AND post button at the bottom, not just post, so we will also need
 *  a drafts section"). One row per unfinished post, several per member; the
 *  id is minted client-side so a compose session keeps upserting its own
 *  row. Owner-only RLS; like wow_intake_drafts, NO assistant path may ever
 *  read these — posting is where a member chooses what anything else sees. */
export type PostDraftRow = {
  id: string;
  draft: Record<string, unknown>;
  updated_at: string;
};

export async function savePostDraft(id: string, profileId: string, draft: unknown): Promise<void> {
  const { error } = await supabase
    .from('post_drafts')
    .upsert({ id, profile_id: profileId, draft, updated_at: new Date().toISOString() }, { onConflict: 'id' });
  if (error) throw error;
}

export async function deletePostDraft(id: string): Promise<void> {
  await supabase.from('post_drafts').delete().eq('id', id);
}

export async function loadPostDraft(id: string): Promise<PostDraftRow | null> {
  const { data } = await supabase
    .from('post_drafts')
    .select('id, draft, updated_at')
    .eq('id', id)
    .maybeSingle();
  return (data as PostDraftRow | null) ?? null;
}

export async function listMyPostDrafts(): Promise<PostDraftRow[]> {
  const { data } = await supabase
    .from('post_drafts')
    .select('id, draft, updated_at')
    .order('updated_at', { ascending: false });
  return (data as PostDraftRow[] | null) ?? [];
}

/** What a drafts list shows for a row — the title, else the body's first
 *  words, else an honest placeholder. */
export function draftLabel(d: Record<string, unknown>): string {
  const t = typeof d.title === 'string' ? d.title.trim() : '';
  if (t) return t;
  const b = typeof d.body === 'string' ? d.body.trim() : '';
  if (b) return b.length > 80 ? b.slice(0, 80) + '…' : b;
  const n = Array.isArray(d.media) ? d.media.length : 0;
  return n ? `Untitled draft · ${n} attachment${n === 1 ? '' : 's'}` : 'Untitled draft';
}
