import { supabase } from './supabase';
import { loadPostsByIds, type FeedPost } from './postsApi';
import { loadMyHidden } from './hiddenApi';

// Save — your private shelf. Strictly owner-only (RLS): what you save is
// invisible to everyone, including the author. Keys mirror the mycelium
// pattern: `${type}:${id}`.
export type SavedTargetType = 'post' | 'profile' | 'space' | 'event' | 'message';

const savedKey = (type: SavedTargetType, id: string) => `${type}:${id}`;

/** Everything I've saved, as a set of `${type}:${id}` keys. */
export async function loadMySaved(): Promise<Set<string>> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Set();
  const { data } = await supabase
    .from('saved_items')
    .select('target_type, target_id')
    .eq('profile_id', user.id);
  return new Set((data ?? []).map((r) => savedKey(r.target_type as SavedTargetType, r.target_id)));
}

/** Shelve or unshelve something. */
export async function setSaved(type: SavedTargetType, id: string, on: boolean): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');
  if (on) {
    const { error } = await supabase
      .from('saved_items')
      .insert({ profile_id: user.id, target_type: type, target_id: id });
    if (error && error.code !== '23505') throw error;
  } else {
    const { error } = await supabase
      .from('saved_items')
      .delete()
      .eq('profile_id', user.id).eq('target_type', type).eq('target_id', id);
    if (error) throw error;
  }
}

/** My saved posts, newest-saved first. Posts RLS no longer lets me see
 *  simply drop out (a deleted listing, a space I left). */
/** Saved posts WITH when you saved them — Drive's chronology sorts saves by
 *  the save, not the post's birthday (founder 2026-08-14). */
export async function loadSavedPostsTimed(): Promise<{ post: FeedPost; savedAt: string }[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data } = await supabase
    .from('saved_items')
    .select('target_id, created_at')
    .eq('profile_id', user.id).eq('target_type', 'post')
    .order('created_at', { ascending: false });
  const hidden = await loadMyHidden();
  const rows = ((data as { target_id: string; created_at: string }[] | null) ?? [])
    .filter((r) => !hidden.has(r.target_id));
  if (rows.length === 0) return [];
  const posts = await loadPostsByIds(rows.map((r) => r.target_id));
  const byId = new Map(posts.map((p) => [p.id, p]));
  return rows
    .map((r) => ({ post: byId.get(r.target_id), savedAt: r.created_at }))
    .filter((x): x is { post: FeedPost; savedAt: string } => !!x.post);
}

export async function loadSavedPosts(): Promise<FeedPost[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data } = await supabase
    .from('saved_items')
    .select('target_id, created_at')
    .eq('profile_id', user.id).eq('target_type', 'post')
    .order('created_at', { ascending: false });
  const hidden = await loadMyHidden();
  const ids = ((data as { target_id: string }[] | null) ?? [])
    .map((r) => r.target_id).filter((id) => !hidden.has(id));
  if (ids.length === 0) return [];
  const posts = await loadPostsByIds(ids);
  const order = new Map(ids.map((id, i) => [id, i]));
  return posts.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

/** A chat message saved to Drive (founder 2026-10-21: the message menu's
 *  "Save (which saves it to drive)"). By REFERENCE, like every save — RLS
 *  decides at read time, so a room you've left or a message since deleted
 *  comes back unreadable and the row says so honestly. */
export interface SavedMessage {
  messageId: string;
  savedAt: string;
  /** Null when the message can't be read any more. */
  chatId: string | null;
  body: string | null;
  hasMedia: boolean;
  senderName: string | null;
  /** Where it was said — "Lichen Alpha Testers · Potluck Planning". */
  chatLabel: string | null;
}

export async function loadSavedMessages(): Promise<SavedMessage[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data } = await supabase
    .from('saved_items')
    .select('target_id, created_at')
    .eq('profile_id', user.id).eq('target_type', 'message')
    .order('created_at', { ascending: false });
  const rows = (data as { target_id: string; created_at: string }[] | null) ?? [];
  if (rows.length === 0) return [];
  const { data: msgs } = await supabase
    .from('chat_messages')
    .select('id, chat_id, body, attachments, sender:profiles!chat_messages_sender_id_fkey(full_name), chat:chats!chat_messages_chat_id_fkey(title, topic, room_space:spaces!chats_space_id_fkey(name))')
    .in('id', rows.map((r) => r.target_id));
  type Row = {
    id: string; chat_id: string; body: string | null;
    attachments: unknown[] | null;
    sender: { full_name: string | null } | null;
    chat: { title: string | null; topic: string | null; room_space: { name: string } | null } | null;
  };
  const byId = new Map(((msgs as unknown as Row[] | null) ?? []).map((m) => [m.id, m]));
  return rows.map((r) => {
    const m = byId.get(r.target_id);
    if (!m) {
      return { messageId: r.target_id, savedAt: r.created_at, chatId: null, body: null, hasMedia: false, senderName: null, chatLabel: null };
    }
    const spaceName = m.chat?.room_space?.name ?? null;
    const chatLabel = spaceName
      ? (m.chat?.topic ? `${spaceName} · ${m.chat.topic}` : spaceName)
      : (m.chat?.title ?? 'a conversation');
    return {
      messageId: m.id,
      savedAt: r.created_at,
      chatId: m.chat_id,
      body: m.body,
      hasMedia: !!m.attachments && m.attachments.length > 0,
      senderName: m.sender?.full_name ?? null,
      chatLabel,
    };
  });
}
