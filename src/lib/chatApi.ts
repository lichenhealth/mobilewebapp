import { supabase } from './supabase';

export type ChatKind = 'organization' | 'community' | 'group' | 'place' | 'care_team';

export interface MemberInfo { profile_id: string; name: string; }
export interface MessageRow {
  id: string;
  chat_id: string;
  sender_id: string;
  body: string;
  created_at: string;
}
export interface ChatVM {
  id: string;
  kind: ChatKind;
  title: string;
  members: MemberInfo[];
  last?: MessageRow;
}

export const KIND_LABEL: Record<ChatKind, string> = {
  organization: 'Organization',
  community: 'Community',
  group: 'Group',
  place: 'Place',
  care_team: 'Care team',
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

interface MemberRowRaw { chat_id: string; profile_id: string; profiles: { full_name: string | null } | null }

/** Load all chats the current member belongs to (RLS scopes this), with
 *  their members and most-recent message, assembled into view models. */
export async function loadChatList(): Promise<ChatVM[]> {
  const [cRes, mRes, msgRes] = await Promise.all([
    supabase.from('chats').select('id, kind, title, created_at'),
    supabase.from('chat_members').select('chat_id, profile_id, profiles(full_name)'),
    supabase.from('chat_messages')
      .select('id, chat_id, sender_id, body, created_at')
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

  const vms: ChatVM[] = ((cRes.data as { id: string; kind: ChatKind; title: string | null }[] | null) ?? []).map((c) => ({
    id: c.id,
    kind: c.kind,
    title: c.title ?? KIND_LABEL[c.kind],
    members: membersByChat.get(c.id) ?? [],
    last: lastByChat.get(c.id),
  }));

  vms.sort((a, b) => {
    const la = a.last ? new Date(a.last.created_at).getTime() : 0;
    const lb = b.last ? new Date(b.last.created_at).getTime() : 0;
    return lb - la;
  });
  return vms;
}
