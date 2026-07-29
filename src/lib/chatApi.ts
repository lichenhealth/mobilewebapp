import { supabase } from './supabase';

export type ChatKind = 'organization' | 'community' | 'group' | 'place' | 'care_team' | 'direct' | 'help';

export type MediaType = 'photo' | 'video' | 'audio';
/** Stored on chat_messages.attachments — `url` is the storage PATH, signed at render time. */
export interface Attachment { type: MediaType; url: string; }

export interface MemberInfo { profile_id: string; name: string; }
export interface MessageRow {
  id: string;
  chat_id: string;
  sender_id: string;
  body: string | null;
  created_at: string;
  attachments?: Attachment[] | null;
  reply_to?: string | null;
}
export interface ReactionRow {
  message_id: string;
  chat_id: string;
  profile_id: string;
  emoji: string;
}
export interface ChatVM {
  id: string;
  kind: ChatKind;
  title: string;
  members: MemberInfo[];
  last?: MessageRow;
}

/** Columns to fetch for a message everywhere (list + thread + realtime re-fetch). */
export const MESSAGE_COLS = 'id, chat_id, sender_id, body, created_at, attachments, reply_to';

export const KIND_LABEL: Record<ChatKind, string> = {
  organization: 'Organization',
  community: 'Community',
  group: 'Group',
  place: 'Place',
  care_team: 'Care team',
  direct: 'Direct',
  help: 'Help',
};

const PALETTE = ['#7E6B96', '#6B8A9C', '#7C8A6D', '#9C7355', '#7C3F4F', '#4A5D3F', '#A89764', '#C97B3F'];

export function colorFor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export function monogramFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function formatRelative(iso: string): string {
  const ts = new Date(iso).getTime();
  const min = Math.floor((Date.now() - ts) / 60_000);
  if (min < 1) return 'now';
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d === 1) return 'yesterday';
  if (d < 7) return new Date(ts).toLocaleDateString(undefined, { weekday: 'short' });
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function dayLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOfDay(now) - startOfDay(d)) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return d.toLocaleDateString(undefined, { weekday: 'long' });
  return d.toLocaleDateString(undefined, {
    month: 'long', day: 'numeric',
    ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
  });
}

interface MemberRowRaw { chat_id: string; profile_id: string; profiles: { full_name: string | null } | null }

/** Title for a chat: for a direct or help chat, the OTHER member's name (title
 *  is null in the DB); otherwise the stored title, falling back to the kind
 *  label. In a help room the "other" is the Lichen support account for the
 *  member, and the member for support — exactly the DM behavior. */
export function chatTitle(
  kind: ChatKind,
  storedTitle: string | null,
  members: MemberInfo[],
  me: string,
): string {
  if (kind === 'direct' || kind === 'help') {
    const other = members.find((m) => m.profile_id !== me) ?? members[0];
    return other?.name ?? 'Direct message';
  }
  return storedTitle ?? KIND_LABEL[kind];
}

/** The other participant in a direct chat (used for avatar monogram/color). */
export function otherMember(members: MemberInfo[], me: string): MemberInfo | undefined {
  return members.find((m) => m.profile_id !== me) ?? members[0];
}

/** One-line preview of a message for the chat list — falls back to an attachment
 *  label when the message is media-only. */
export function messagePreview(msg: MessageRow): string {
  if (msg.body && msg.body.trim()) return msg.body;
  const a = msg.attachments;
  if (a && a.length) {
    const t = a[0].type;
    const label = t === 'photo' ? 'Photo' : t === 'video' ? 'Video' : 'Audio';
    return `📎 ${label}${a.length > 1 ? ` +${a.length - 1}` : ''}`;
  }
  return '';
}

/** Load the chats the current member belongs to for the Signal-style Messages
 *  list (RLS scopes this): communities, groups, places, organizations, and 1:1
 *  direct chats. Care-team chats are intentionally EXCLUDED — they live in the
 *  Concierge screen, not the general inbox. */
export async function loadChatList(me: string): Promise<ChatVM[]> {
  const [cRes, mRes, msgRes] = await Promise.all([
    // care-team rooms live in Concierge; event rooms live on their event page
    supabase.from('chats').select('id, kind, title, created_at').not('kind', 'in', '("care_team","event")'),
    supabase.from('chat_members').select('chat_id, profile_id, profiles(full_name)'),
    supabase.from('chat_messages')
      .select(MESSAGE_COLS)
      .order('created_at', { ascending: false })
      .limit(1000),
  ]);

  const membersByChat = new Map<string, MemberInfo[]>();
  for (const r of (mRes.data as MemberRowRaw[] | null) ?? []) {
    const arr = membersByChat.get(r.chat_id) ?? [];
    arr.push({ profile_id: r.profile_id, name: r.profiles?.full_name ?? 'Member' });
    membersByChat.set(r.chat_id, arr);
  }

  const lastByChat = new Map<string, MessageRow>();
  for (const m of (msgRes.data as MessageRow[] | null) ?? []) {
    if (!lastByChat.has(m.chat_id)) lastByChat.set(m.chat_id, m); // desc → first is latest
  }

  const vms: ChatVM[] = ((cRes.data as { id: string; kind: ChatKind; title: string | null }[] | null) ?? []).map((c) => {
    const members = membersByChat.get(c.id) ?? [];
    return {
      id: c.id,
      kind: c.kind,
      title: chatTitle(c.kind, c.title, members, me),
      members,
      last: lastByChat.get(c.id),
    };
  });

  vms.sort((a, b) => {
    const la = a.last ? new Date(a.last.created_at).getTime() : 0;
    const lb = b.last ? new Date(b.last.created_at).getTime() : 0;
    return lb - la;
  });
  return vms;
}

/** Find-or-create the 1:1 direct chat with another member; returns its id. */
/** Per-conversation unread counts (messages newer than my read cursor). */
export async function loadUnreadCounts(): Promise<Map<string, number>> {
  const { data, error } = await supabase.rpc('chat_unread_counts');
  if (error) { console.warn('chat_unread_counts:', error.message); return new Map(); }
  return new Map(((data as { chat_id: string; unread: number }[] | null) ?? [])
    .map((r) => [r.chat_id, Number(r.unread)]));
}

/** Reading a chat: bump my read cursor + clear its bell notifications. */
export async function markChatRead(chatId: string): Promise<void> {
  const { error } = await supabase.rpc('mark_chat_read', { p_chat: chatId });
  if (error) console.warn('mark_chat_read:', error.message);
}

export async function ensureDirectChat(otherId: string): Promise<string> {
  const { data, error } = await supabase.rpc('ensure_direct_chat', { p_other: otherId });
  if (error) throw error;
  return data as string;
}

/** Find-or-create my Help room with the Lichen support account; returns its id. */
export async function ensureHelpChat(): Promise<string> {
  const { data, error } = await supabase.rpc('ensure_help_chat');
  if (error) throw error;
  return data as string;
}

// ─── Concierge access ────────────────────────────────────────────────────────

/** Whether the member may use Concierge features (care-team chat, caregiver
 *  dashboard): an active Concierge subscription, or an admin. */
export async function loadConciergeAccess(me: string): Promise<boolean> {
  const [subRes, profRes] = await Promise.all([
    supabase.from('subscriptions').select('tier, status').eq('profile_id', me).maybeSingle(),
    supabase.from('profiles').select('is_admin').eq('id', me).maybeSingle(),
  ]);
  const sub = subRes.data as { tier: string; status: string } | null;
  const isAdmin = (profRes.data as { is_admin: boolean } | null)?.is_admin ?? false;
  return isAdmin || (sub?.tier === 'concierge' && sub?.status === 'active');
}

// ─── Caregiver dashboard ─────────────────────────────────────────────────────

export interface CareClient {
  patient_id: string;
  name: string;
  chatId: string | null;
  last?: MessageRow;
}

/** The patients the current member actively cares for, each with their care-team
 *  chat + most-recent message, ordered by last engagement (most recent first).
 *  Powers the caregiver dashboard. */
export async function loadCareClients(me: string): Promise<CareClient[]> {
  const { data: links } = await supabase
    .from('care_team_members')
    .select('patient_id, patient:profiles!care_team_members_patient_id_fkey(full_name)')
    .eq('caregiver_id', me)
    .eq('status', 'active');

  const rows = (links as { patient_id: string; patient: { full_name: string | null } | null }[] | null) ?? [];
  if (rows.length === 0) return [];

  const patientIds = rows.map((r) => r.patient_id);
  const chatRes = await supabase
    .from('chats').select('id, patient_id').eq('kind', 'care_team').in('patient_id', patientIds);

  const chatByPatient = new Map<string, string>();
  const chatIds: string[] = [];
  for (const c of (chatRes.data as { id: string; patient_id: string }[] | null) ?? []) {
    chatByPatient.set(c.patient_id, c.id);
    chatIds.push(c.id);
  }

  const lastByChat = new Map<string, MessageRow>();
  if (chatIds.length) {
    const { data: msgs } = await supabase
      .from('chat_messages')
      .select(MESSAGE_COLS)
      .in('chat_id', chatIds)
      .order('created_at', { ascending: false })
      .limit(500);
    for (const m of (msgs as MessageRow[] | null) ?? []) {
      if (!lastByChat.has(m.chat_id)) lastByChat.set(m.chat_id, m); // desc → first is latest
    }
  }

  const clients: CareClient[] = rows.map((r) => {
    const chatId = chatByPatient.get(r.patient_id) ?? null;
    return {
      patient_id: r.patient_id,
      name: r.patient?.full_name ?? 'Member',
      chatId,
      last: chatId ? lastByChat.get(chatId) : undefined,
    };
  });

  clients.sort((a, b) => {
    const la = a.last ? new Date(a.last.created_at).getTime() : 0;
    const lb = b.last ? new Date(b.last.created_at).getTime() : 0;
    return lb - la;
  });
  return clients;
}

// ─── Chat media (private bucket — paths stored, signed at render) ────────────

/** Upload a chat attachment into `chat-media/<chatId>/…`; returns the storage PATH. */
export async function uploadChatMedia(chatId: string, file: Blob, ext: string): Promise<string> {
  const path = `${chatId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const { error } = await supabase.storage.from('chat-media').upload(path, file);
  if (error) throw error;
  return path;
}

/** Batch-sign storage paths (1h TTL) → map of path → signed URL. */
export async function signChatMedia(paths: string[]): Promise<Record<string, string>> {
  const unique = [...new Set(paths)].filter(Boolean);
  if (unique.length === 0) return {};
  const { data, error } = await supabase.storage.from('chat-media').createSignedUrls(unique, 3600);
  if (error || !data) return {};
  const map: Record<string, string> = {};
  for (const r of data) if (r.path && r.signedUrl) map[r.path] = r.signedUrl;
  return map;
}

// ─── Reactions ──────────────────────────────────────────────────────────────

export const REACTION_EMOJI = ['❤️', '👍', '🙏', '😊', '🌱'];

/** Load all reactions for a chat's messages. */
export async function loadReactions(chatId: string): Promise<ReactionRow[]> {
  const { data } = await supabase
    .from('chat_message_reactions')
    .select('message_id, chat_id, profile_id, emoji')
    .eq('chat_id', chatId);
  return (data as ReactionRow[] | null) ?? [];
}

/** Add or remove one of the caller's reactions on a message. */
export async function toggleReaction(
  chatId: string, messageId: string, emoji: string, me: string, on: boolean,
): Promise<void> {
  if (on) {
    await supabase.from('chat_message_reactions')
      .insert({ message_id: messageId, chat_id: chatId, profile_id: me, emoji });
  } else {
    await supabase.from('chat_message_reactions')
      .delete()
      .eq('message_id', messageId).eq('profile_id', me).eq('emoji', emoji);
  }
}

// ─── Searching your conversations (founder 2026-07-28) ──────────────────────
// The inbox already matches names and the latest line; this reaches back
// through message HISTORY. RLS does the scoping: is_chat_member() means you
// can only ever search rooms you're in.
export interface MessageHit {
  id: string;
  chat_id: string;
  body: string;
  created_at: string;
  sender_id: string;
  senderName?: string;
}

export async function searchMessages(query: string, limit = 30): Promise<MessageHit[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const { data, error } = await supabase
    .from('chat_messages')
    .select('id, chat_id, body, created_at, sender_id')
    .ilike('body', `%${q}%`)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) { console.warn('searchMessages:', error.message); return []; }
  const rows = (data as MessageHit[] | null) ?? [];
  const ids = [...new Set(rows.map((r) => r.sender_id))];
  if (ids.length) {
    const { data: profs } = await supabase.from('profiles').select('id, full_name').in('id', ids);
    const names = new Map(((profs as { id: string; full_name: string | null }[] | null) ?? [])
      .map((p) => [p.id, p.full_name ?? 'A member']));
    rows.forEach((r) => { r.senderName = names.get(r.sender_id); });
  }
  return rows;
}
