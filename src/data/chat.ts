/* ====================================================================
   LICHEN — Chat mock data
   Conversations + messages. Designed to showcase: groups, replies,
   reactions, and search.
==================================================================== */

export interface ChatUser {
  id: string;
  name: string;
  handle: string;
  monogram: string;
  color?: string;          // accent color for sender name in groups
}

export interface ChatReaction {
  emoji: string;
  userIds: string[];
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  senderId: string;        // user id, or 'me' for the current user
  text: string;
  ts: number;              // epoch ms
  replyToId?: string;
  reactions?: ChatReaction[];
}

export interface Conversation {
  id: string;
  kind: '1:1' | 'group';
  name: string;                // display name / group name
  handle?: string;             // for 1:1, the @handle of the other person
  monogram: string;
  description?: string;        // group description
  memberIds: string[];         // does NOT include 'me'
  pinned?: boolean;
  muted?: boolean;
}

// ─── Users ────────────────────────────────────────────────────────────
export const ME: ChatUser = {
  id: 'me',
  name: 'You',
  handle: '@galyn',
  monogram: 'G',
};

export const USERS: Record<string, ChatUser> = {
  me: ME,
  mara: {
    id: 'mara', name: 'Mara Beckett', handle: '@mara-cascadia', monogram: 'M',
    color: '#7C8A6D',
  },
  theo: {
    id: 'theo', name: 'Theo Ramírez', handle: '@theo-builds', monogram: 'T',
    color: '#B8623C',
  },
  joon: {
    id: 'joon', name: 'Joon Park', handle: '@joon-paints-slow', monogram: 'J',
    color: '#7C3F4F',
  },
  mark: {
    id: 'mark', name: 'Mark Sutter', handle: '@mountainbeef', monogram: 'M',
    color: '#4A5D3F',
  },
  rosa: {
    id: 'rosa', name: 'Rosa Inoue', handle: '@rosa-quietlibrary', monogram: 'R',
    color: '#6B8A9C',
  },
  bailey: {
    id: 'bailey', name: 'Bailey Cole', handle: '@lichen-bailey-CO', monogram: 'B',
    color: '#A89764',
  },
  marcus: {
    id: 'marcus', name: 'Marcus Liu', handle: '@marcus-fieldnotes', monogram: 'M',
    color: '#3A4742',
  },
  june: {
    id: 'june', name: 'June Okafor', handle: '@june-sundaysupper', monogram: 'J',
    color: '#C97B3F',
  },
};

// ─── Conversations ────────────────────────────────────────────────────
export const CONVERSATIONS: Conversation[] = [
  {
    id: 'c-growers',
    kind: 'group',
    name: 'Cascadia Growers',
    monogram: 'CG',
    description: '184 members · Seasonal sowing, seed swaps, growing notes',
    memberIds: ['mara', 'theo', 'rosa', 'marcus', 'june', 'bailey'],
    pinned: true,
  },
  {
    id: 'c-mara',
    kind: '1:1',
    name: 'Mara Beckett',
    handle: '@mara-cascadia',
    monogram: 'M',
    memberIds: ['mara'],
  },
  {
    id: 'c-suppers',
    kind: 'group',
    name: 'Sunday Suppers',
    monogram: 'SS',
    description: '62 members · Rotating dinners at members\u2019 tables',
    memberIds: ['june', 'theo', 'rosa', 'mara'],
  },
  {
    id: 'c-mark',
    kind: '1:1',
    name: 'Mark Sutter',
    handle: '@mountainbeef',
    monogram: 'M',
    memberIds: ['mark'],
  },
  {
    id: 'c-mons-sana',
    kind: 'group',
    name: 'Mons Sana',
    monogram: 'MS',
    description: '248 members · Bodywork, land care, contemplative practice',
    memberIds: ['joon', 'rosa', 'bailey', 'marcus'],
    muted: true,
  },
  {
    id: 'c-theo',
    kind: '1:1',
    name: 'Theo Ramírez',
    handle: '@theo-builds',
    monogram: 'T',
    memberIds: ['theo'],
  },
  {
    id: 'c-joon',
    kind: '1:1',
    name: 'Joon Park',
    handle: '@joon-paints-slow',
    monogram: 'J',
    memberIds: ['joon'],
  },
];

// ─── Messages ─────────────────────────────────────────────────────────
// Times are computed relative to "now" so the chat always feels fresh.
const NOW = Date.now();
const m  = (n: number) => NOW - n * 60_000;
const hr = (n: number) => NOW - n * 60 * 60_000;
const d  = (n: number) => NOW - n * 24 * 60 * 60_000;

export const MESSAGES: ChatMessage[] = [
  // ─── Cascadia Growers (active group, replies + reactions) ───────────
  { id: 'g1',  conversationId: 'c-growers', senderId: 'mara',
    text: 'Anyone else seeing flea beetles on their brassicas this week? Mine came in two weeks early.',
    ts: hr(3),
    reactions: [{ emoji: '🪲', userIds: ['theo', 'rosa'] }] },
  { id: 'g2',  conversationId: 'c-growers', senderId: 'marcus',
    text: 'Yes. Row cover is the only thing working for me. I gave up on neem this year.',
    ts: hr(2.7) },
  { id: 'g3',  conversationId: 'c-growers', senderId: 'theo',
    text: 'I\u2019ve had luck planting a sacrificial row of arugula on the windward edge. Decoy crop.',
    ts: hr(2.5), replyToId: 'g1',
    reactions: [{ emoji: '🌱', userIds: ['mara', 'rosa', 'me'] }, { emoji: '🙌', userIds: ['marcus'] }] },
  { id: 'g4',  conversationId: 'c-growers', senderId: 'me',
    text: 'Decoy crop is genius. Taking notes.',
    ts: hr(2.4), replyToId: 'g3' },
  { id: 'g5',  conversationId: 'c-growers', senderId: 'rosa',
    text: 'Reminder: seed swap Saturday at the back garden, 10\u20132. Bring labeled envelopes if you can.',
    ts: hr(1),
    reactions: [{ emoji: '❤️', userIds: ['mara', 'theo', 'june', 'me'] }, { emoji: '🌻', userIds: ['marcus'] }] },
  { id: 'g6',  conversationId: 'c-growers', senderId: 'june',
    text: 'I\u2019ll bring sourdough and a jar of last year\u2019s tomato seeds (the orange ones everyone liked).',
    ts: m(38), replyToId: 'g5',
    reactions: [{ emoji: '🍅', userIds: ['mara', 'rosa', 'theo'] }] },
  { id: 'g7',  conversationId: 'c-growers', senderId: 'mara',
    text: 'Bringing scions if anyone wants apple grafting wood. Two varieties — Ashmead\u2019s and a russet I haven\u2019t identified yet.',
    ts: m(12) },

  // ─── Mara 1:1 ───────────────────────────────────────────────────────
  { id: 'mar1', conversationId: 'c-mara', senderId: 'mara',
    text: 'Hey — were you going to come by Thursday or did Friday work better?',
    ts: hr(5.2) },
  { id: 'mar2', conversationId: 'c-mara', senderId: 'me',
    text: 'Friday is better. Around 4?',
    ts: hr(5),
    reactions: [{ emoji: '👍', userIds: ['mara'] }] },
  { id: 'mar3', conversationId: 'c-mara', senderId: 'mara',
    text: 'Perfect. I\u2019ll have the cuttings ready and the kettle on.',
    ts: hr(4.8) },
  { id: 'mar4', conversationId: 'c-mara', senderId: 'mara',
    text: 'Oh — and if you have any of that elderflower cordial left, that would be the greatest gift.',
    ts: m(45) },

  // ─── Sunday Suppers ─────────────────────────────────────────────────
  { id: 's1', conversationId: 'c-suppers', senderId: 'june',
    text: 'This week is at my place. 6pm. Bringing anything is optional but very welcome.',
    ts: hr(8),
    reactions: [{ emoji: '🍽️', userIds: ['theo', 'rosa', 'mara', 'me'] }] },
  { id: 's2', conversationId: 'c-suppers', senderId: 'rosa',
    text: 'I\u2019ll bring a salad with the last of the bitter greens.',
    ts: hr(7.7) },
  { id: 's3', conversationId: 'c-suppers', senderId: 'theo',
    text: 'Wine.',
    ts: hr(7),
    reactions: [{ emoji: '🍷', userIds: ['june', 'rosa', 'mara', 'me'] }] },
  { id: 's4', conversationId: 'c-suppers', senderId: 'me',
    text: 'I can bring bread and a board of cheese. Any allergies I should know about?',
    ts: hr(6.5) },
  { id: 's5', conversationId: 'c-suppers', senderId: 'june',
    text: 'None this week! See you all Sunday.',
    ts: hr(6) },

  // ─── Mark (beef) ────────────────────────────────────────────────────
  { id: 'mk1', conversationId: 'c-mark', senderId: 'mark',
    text: 'Hi — saw you trusted the beef post. Wanted to follow up directly. Are you thinking quarter share or half?',
    ts: d(1) },
  { id: 'mk2', conversationId: 'c-mark', senderId: 'me',
    text: 'Quarter, I think. How much freezer space does that need?',
    ts: d(1) + 12 * 60_000 },
  { id: 'mk3', conversationId: 'c-mark', senderId: 'mark',
    text: 'A quarter share is roughly 100 lbs of cut and wrapped beef. Plan on about 4 cubic feet of freezer — a small chest freezer handles it with room to spare.',
    ts: d(1) + 15 * 60_000 },
  { id: 'mk4', conversationId: 'c-mark', senderId: 'mark',
    text: 'I\u2019ll send the cut sheet over later today. You can mark what you want and we\u2019ll go from there.',
    ts: hr(20),
    reactions: [{ emoji: '🙏', userIds: ['me'] }] },

  // ─── Mons Sana (muted group, quiet) ─────────────────────────────────
  { id: 'ms1', conversationId: 'c-mons-sana', senderId: 'joon',
    text: 'Studio open Saturday, 2 to 6. No agenda, just paint and quiet.',
    ts: d(2) },
  { id: 'ms2', conversationId: 'c-mons-sana', senderId: 'bailey',
    text: 'I\u2019ll be there.',
    ts: d(2) + 30 * 60_000,
    reactions: [{ emoji: '🎨', userIds: ['joon'] }] },
  { id: 'ms3', conversationId: 'c-mons-sana', senderId: 'rosa',
    text: 'Bringing a thermos of mint tea and a book. Don\u2019t feel like talking but want to be in the room.',
    ts: d(2) + 35 * 60_000,
    reactions: [{ emoji: '❤️', userIds: ['joon', 'bailey'] }] },

  // ─── Theo 1:1 ───────────────────────────────────────────────────────
  { id: 't1', conversationId: 'c-theo', senderId: 'theo',
    text: 'Barn raising is set for the 21st. Need three more pairs of hands if anyone you know is around.',
    ts: d(3) },
  { id: 't2', conversationId: 'c-theo', senderId: 'me',
    text: 'I\u2019ll ask around. Is there a list of what to bring?',
    ts: d(3) + 60 * 60_000 },
  { id: 't3', conversationId: 'c-theo', senderId: 'theo',
    text: 'Just yourself, work clothes, and a packed lunch. We\u2019ll provide tools, coffee, and dinner after.',
    ts: d(3) + 65 * 60_000 },

  // ─── Joon 1:1 ───────────────────────────────────────────────────────
  { id: 'j1', conversationId: 'c-joon', senderId: 'joon',
    text: 'The tempera I sent you should be dry by now. Worth letting it cure for another week before varnishing.',
    ts: d(5) },
];

// ─── Helpers ──────────────────────────────────────────────────────────
export function messagesFor(conversationId: string): ChatMessage[] {
  return MESSAGES
    .filter((m) => m.conversationId === conversationId)
    .sort((a, b) => a.ts - b.ts);
}

export function lastMessage(conversationId: string): ChatMessage | undefined {
  const list = messagesFor(conversationId);
  return list[list.length - 1];
}

export function unreadCount(conversationId: string): number {
  // Mock: pretend any message in the last 90 min from someone else is unread
  const cutoff = NOW - 90 * 60_000;
  return MESSAGES.filter(
    (m) => m.conversationId === conversationId && m.senderId !== 'me' && m.ts > cutoff
  ).length;
}

export function formatRelative(ts: number): string {
  const diffMs = NOW - ts;
  const min = Math.floor(diffMs / 60_000);
  if (min < 1) return 'now';
  if (min < 60) return `${min}m`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) {
    return new Date(ts).toLocaleDateString(undefined, { weekday: 'short' });
  }
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
