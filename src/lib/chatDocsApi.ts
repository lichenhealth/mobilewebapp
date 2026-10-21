import { supabase } from './supabase';
import type { IconName } from '../components/Icon';

/** Docs, polls and spreadsheets born in a chat room's composer (founder
 *  2026-10-21). A row IS the room-drive item: chat_id is the room whose
 *  drive holds it, space_id (trigger-stamped from the chat, never written
 *  here) nests that drive under the group's greater drive.
 *  ai_enabled=false is the per-ITEM AI consent — the gray slashed-brain
 *  decal in every rendering, and a hard filter for any future assistant
 *  read path (none reads chat_docs today; keep it that way without one). */

export type ChatDocKind = 'doc' | 'poll' | 'sheet';

export interface ChatDocRow {
  id: string;
  chat_id: string;
  space_id: string | null;
  kind: ChatDocKind;
  title: string;
  body: string | null;
  data: { options?: string[]; cells?: string[][] } | null;
  ai_enabled: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
  updated_by: string | null;
}

export interface PollVote { doc_id: string; profile_id: string; option_idx: number }

export const DOC_KIND_LABEL: Record<ChatDocKind, string> = { doc: 'Doc', poll: 'Poll', sheet: 'Spreadsheet' };
export const DOC_KIND_ICON: Record<ChatDocKind, IconName> = { doc: 'book', poll: 'check', sheet: 'grip' };

const DOC_COLS = 'id, chat_id, space_id, kind, title, body, data, ai_enabled, created_by, created_at, updated_at, updated_by';

export async function createChatDoc(
  me: string,
  chatId: string,
  kind: ChatDocKind,
  title: string,
  opts: { ai?: boolean; options?: string[] } = {},
): Promise<ChatDocRow> {
  const data = kind === 'poll'
    ? { options: (opts.options ?? []).map((o) => o.trim()).filter(Boolean) }
    : kind === 'sheet'
      ? { cells: [['', '', ''], ['', '', ''], ['', '', '']] }
      : null;
  const { data: row, error } = await supabase
    .from('chat_docs')
    .insert({ chat_id: chatId, kind, title: title.trim(), data, ai_enabled: opts.ai !== false, created_by: me })
    .select(DOC_COLS)
    .single();
  if (error) throw new Error(error.message);
  return row as unknown as ChatDocRow;
}

export async function loadChatDoc(id: string): Promise<ChatDocRow | null> {
  const { data, error } = await supabase.from('chat_docs').select(DOC_COLS).eq('id', id).maybeSingle();
  if (error) { console.warn('loadChatDoc:', error.message); return null; }
  return (data as unknown as ChatDocRow | null) ?? null;
}

/** Collaborative save — any room member may edit words/cells; the server
 *  trigger keeps identity columns and the AI switch honest. */
export async function saveChatDoc(id: string, patch: { title?: string; body?: string | null; data?: ChatDocRow['data'] }): Promise<void> {
  const { error } = await supabase.from('chat_docs').update(patch).eq('id', id);
  if (error) throw new Error(error.message);
}

/** The author's (or a space admin's) switch — the server refuses anyone else. */
export async function setChatDocAi(id: string, on: boolean): Promise<void> {
  const { error } = await supabase.from('chat_docs').update({ ai_enabled: on }).eq('id', id);
  if (error) throw new Error(error.message);
}

export async function deleteChatDoc(id: string): Promise<void> {
  const { error } = await supabase.from('chat_docs').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

/** One room's drive, newest first. */
export async function listChatDocs(chatId: string): Promise<ChatDocRow[]> {
  const { data, error } = await supabase
    .from('chat_docs').select(DOC_COLS)
    .eq('chat_id', chatId)
    .order('created_at', { ascending: false });
  if (error) { console.warn('listChatDocs:', error.message); return []; }
  return (data as unknown as ChatDocRow[] | null) ?? [];
}

/** How many items each of a space's rooms holds — the greater drive's
 *  folder counts (RLS scopes to rooms the viewer is in). */
export async function countSpaceDocsByChat(spaceId: string): Promise<Map<string, number>> {
  const { data, error } = await supabase.from('chat_docs').select('chat_id').eq('space_id', spaceId);
  if (error) { console.warn('countSpaceDocsByChat:', error.message); return new Map(); }
  const m = new Map<string, number>();
  for (const r of (data as { chat_id: string }[] | null) ?? []) m.set(r.chat_id, (m.get(r.chat_id) ?? 0) + 1);
  return m;
}

export async function loadVotes(docId: string): Promise<PollVote[]> {
  const { data, error } = await supabase
    .from('chat_poll_votes').select('doc_id, profile_id, option_idx')
    .eq('doc_id', docId);
  if (error) { console.warn('loadVotes:', error.message); return []; }
  return (data as PollVote[] | null) ?? [];
}

/** Cast or change my vote (one per member, the pk's rule). */
export async function castVote(me: string, docId: string, optionIdx: number): Promise<void> {
  const { error } = await supabase
    .from('chat_poll_votes')
    .upsert({ doc_id: docId, profile_id: me, option_idx: optionIdx }, { onConflict: 'doc_id,profile_id' });
  if (error) throw new Error(error.message);
}

export async function retractVote(me: string, docId: string): Promise<void> {
  const { error } = await supabase.from('chat_poll_votes').delete().eq('doc_id', docId).eq('profile_id', me);
  if (error) throw new Error(error.message);
}
