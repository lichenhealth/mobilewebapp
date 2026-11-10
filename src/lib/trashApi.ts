import { supabase } from './supabase';

/** THE TRASH (founder 2026-11-10: "a trash that waits with everything until
 *  you empty it. There is a meta trash for the entire platform, then a trash
 *  for drive, profile, library, courses, etc").
 *
 *  A delete stays a real delete — no read path anywhere learns a new filter —
 *  but first a SNAPSHOT of the row lands in `trash_items`. Restore re-inserts
 *  it through the table's own insert policy (so a restore can never do more
 *  than the person could do by hand). Nothing auto-purges. Each section's
 *  trash is the one /trash page through a filter (the scoped-section rule).
 *
 *  Spam knocks are the one exception: they never leave join_requests (the
 *  labeled row bars re-knocking and trains spam detection), so their trash
 *  is a VIEW of status='spam' rows, and emptying stamps spam_emptied_at. */

export type TrashKind = 'post' | 'draft' | 'doc' | 'file' | 'folder';
export type TrashItem = {
  id: string; section: string; kind: TrashKind; label: string | null;
  ref_id: string | null; payload: Record<string, unknown>; extra: Record<string, unknown> | null;
  trashed_at: string;
};

/** The sections a trash row can file under, in the order the page shows them. */
export const TRASH_SECTIONS: { key: string; label: string; icon: string }[] = [
  { key: 'drive', label: 'Drive', icon: 'drive' },
  { key: 'feed', label: 'Feed', icon: 'newsfeed' },
  { key: 'marketplace', label: 'Marketplace', icon: 'store' },
  { key: 'events', label: 'Events', icon: 'calendar' },
  { key: 'courses', label: 'Courses', icon: 'graduation-cap' },
  { key: 'library', label: 'Library', icon: 'book' },
  { key: 'art', label: 'Creative', icon: 'palette' },
  { key: 'work', label: 'Work', icon: 'briefcase' },
  { key: 'food', label: 'Food', icon: 'fork-spoon' },
  { key: 'travel', label: 'Travel', icon: 'plane' },
  { key: 'door', label: 'At the door', icon: 'user-multiple' },
];

const POST_SECTION_ORDER = ['events', 'courses', 'library', 'marketplace', 'travel', 'art', 'food', 'work'];
function sectionOfPost(areas: unknown): string {
  const a = Array.isArray(areas) ? (areas as string[]) : [];
  return POST_SECTION_ORDER.find((s) => a.includes(s)) ?? 'feed';
}

async function stash(kind: TrashKind, section: string, label: string, refId: string, payload: unknown, extra?: unknown) {
  const { error } = await supabase.from('trash_items').insert({
    kind, section, label: label.slice(0, 200), ref_id: refId, payload, extra: extra ?? null,
  });
  if (error) throw error;
}

/** A post goes to the trash. An EVENT's post is cancelled for real (its
 *  calendar row, guests and chat are gone with it — restore couldn't bring
 *  them back), so it skips the trash. */
export async function trashPost(id: string): Promise<void> {
  const { data: row, error } = await supabase.from('posts').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  if (row && !row.linked_event_id) {
    const label = (row.title as string | null)?.trim() || String(row.body ?? '').slice(0, 80) || 'Untitled post';
    await stash('post', sectionOfPost(row.service_areas), label, id, row);
  }
  const { error: dErr } = await supabase.from('posts').delete().eq('id', id);
  if (dErr) throw dErr;
}

export async function trashPostDraft(id: string, label: string): Promise<void> {
  const { data: row } = await supabase.from('post_drafts').select('*').eq('id', id).maybeSingle();
  if (row) await stash('draft', 'drive', label || 'Untitled draft', id, row);
  const { error } = await supabase.from('post_drafts').delete().eq('id', id);
  if (error) throw error;
}

export async function trashDoc(id: string): Promise<void> {
  const { data: row } = await supabase.from('chat_docs').select('*').eq('id', id).maybeSingle();
  // Only a PERSONAL doc (no room) can come back by the owner's hand; a room's
  // doc belongs to the room and keeps its old real delete.
  if (row && !row.chat_id) await stash('doc', 'drive', (row.title as string) || 'Untitled', id, row);
  const { error } = await supabase.from('chat_docs').delete().eq('id', id);
  if (error) throw error;
}

/** The row leaves Drive; the stored FILE waits in storage until the trash
 *  is emptied. */
export async function trashDriveFile(row: { id: string; path: string; title: string | null }): Promise<void> {
  const { data: full } = await supabase.from('drive_files').select('*').eq('id', row.id).maybeSingle();
  if (full) await stash('file', 'drive', row.title || row.path.split('/').pop() || 'File', row.id, full);
  const { error } = await supabase.from('drive_files').delete().eq('id', row.id);
  if (error) throw error;
}

/** A folder and the references it held (its pieces stay where they live). */
export async function trashFolder(id: string): Promise<void> {
  const { data: row } = await supabase.from('collections').select('*').eq('id', id).maybeSingle();
  if (row) {
    const { data: items } = await supabase.from('collection_items').select('*').eq('collection_id', id);
    await stash('folder', row.kind === 'course' ? 'courses' : 'drive', (row.name as string) || 'Folder', id, row, { items: items ?? [] });
  }
  const { error } = await supabase.from('collections').delete().eq('id', id);
  if (error) throw error;
}

export async function listTrash(): Promise<TrashItem[]> {
  const { data } = await supabase.from('trash_items')
    .select('id, section, kind, label, ref_id, payload, extra, trashed_at')
    .order('trashed_at', { ascending: false });
  return (data as TrashItem[] | null) ?? [];
}

const TABLE: Record<TrashKind, string> = {
  post: 'posts', draft: 'post_drafts', doc: 'chat_docs', file: 'drive_files', folder: 'collections',
};

/** Put it back where it lived, under the same id. */
export async function restoreTrash(item: TrashItem): Promise<void> {
  const { error } = await supabase.from(TABLE[item.kind]).insert(item.payload);
  if (error) {
    if (error.code === '23505') throw new Error('Something with that address or name already exists — rename it, then try again.');
    throw new Error(error.message);
  }
  if (item.kind === 'folder') {
    const items = (item.extra?.items as Record<string, unknown>[] | undefined) ?? [];
    // One at a time: a piece its author has since held back is skipped, never the folder.
    for (const it of items) await supabase.from('collection_items').insert(it);
  }
  await supabase.from('trash_items').delete().eq('id', item.id);
}

/** For good. Files leave storage only now. */
export async function emptyTrash(items: TrashItem[]): Promise<void> {
  if (items.length === 0) return;
  const paths = items.filter((i) => i.kind === 'file').map((i) => String(i.payload.path ?? '')).filter(Boolean);
  if (paths.length) await supabase.storage.from('drive').remove(paths);
  const { error } = await supabase.from('trash_items').delete().in('id', items.map((i) => i.id));
  if (error) throw error;
}

// ── Spam knocks ────────────────────────────────────────────────────────────
export type SpamKnock = { id: string; name: string | null; email: string | null; story: string | null; created_at: string; space_id: string | null };

/** Every spam knock this person can answer (RLS: platform admins see all,
 *  stewards their own spaces'), not yet emptied. */
export async function listSpamKnocks(): Promise<SpamKnock[]> {
  const { data } = await supabase.from('join_requests')
    .select('id, name, email, story, created_at, space_id')
    .eq('status', 'spam').is('spam_emptied_at', null)
    .order('created_at', { ascending: false }).limit(100);
  return (data as SpamKnock[] | null) ?? [];
}

/** Not spam after all — back to the door. */
export async function restoreSpamKnock(id: string): Promise<void> {
  const { error } = await supabase.from('join_requests').update({ status: 'new' }).eq('id', id);
  if (error) throw error;
}

/** Hidden for good; the labeled row stays (it still bars a re-knock). */
export async function emptySpamKnocks(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await supabase.from('join_requests')
    .update({ spam_emptied_at: new Date().toISOString() }).in('id', ids);
  if (error) throw error;
}
