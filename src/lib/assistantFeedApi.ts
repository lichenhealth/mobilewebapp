import { supabase } from './supabase';

/** A photo pasted into the feed — the same shape chat attachments wear — or
 *  the marker a Claude reply carries after editing a page (founder
 *  2026-08-31): the edit landed in the DRAFT, and the client hangs Preview
 *  and Publish buttons on the reply. `tab` is where the edit landed, so the
 *  smart Preview opens the page on the content in question. */
export type FeedAttachment =
  | { type: 'photo'; url: string }
  | { type: 'page_edit'; subject: 'space' | 'profile'; id: string; tab?: string }
  /** The treasury handoff (founder 2026-10-06): a verified door into a
   *  stewarded space's own Current-cy room — the client's button flips the
   *  member's hat and lands there. */
  | { type: 'space_thread'; room: 'currentcy'; id: string; name: string; kind: string }
  /** The consent offer (same message: "would you like to switch that
   *  permission? Then link to letting them do that to turn it on") — the
   *  PERSON taps to re-enable; the model never arms anything. `which` names
   *  the switch: the member's own per-space choice, or the space's own
   *  assistant switch (steward-flippable). */
  | { type: 'space_consent'; room: 'currentcy'; id: string; name: string; kind: string; which: 'member' | 'space' };

export interface FeedPostRow {
  id: string;
  author: 'member' | 'claude';
  body: string;
  source_post_id: string | null;
  thread: string;
  /** Which CONVERSATION inside the thread this entry belongs to (founder
   *  2026-10-05: a thread is a newest-first list of conversations now, the
   *  email grammar). Minted client-side on a fresh conversation's first
   *  send; replies echo the trigger's; history was backfilled by time gap.
   *  Null = a space build thread's continuous stream (deliberate). */
  convo_id: string | null;
  created_at: string;
  attachments: FeedAttachment[] | null;
}

// THREADS (founder 2026-08-11) — "since we're weaving a tapestry": the
// assistant keeps a thread per part of the platform, so work stays where it
// belongs. Press AI inside Marketplace and what you say is logged in the
// Marketplace thread. Each thread weaves into its section's tapestry, and
// those into the whole ecosystem — which is what General reads across.
// (A space-scoped thread — Countryman Stables' Marketplace — is the same
// idea one level in; the column is free text so it needs no migration.)
export interface AssistantThread {
  id: string; label: string; blurb: string;
  /** The section's own mark — the same icon the TopBar wears there. */
  icon: string;
  /** Empty-thread greeting when the member has nothing IN that section yet. */
  emptyAsk: string;
  /** Empty-thread greeting when the section already holds their work. */
  welcome: string;
}

export const ASSISTANT_THREADS: AssistantThread[] = [
  {
    id: 'general', label: 'General', icon: 'brain',
    blurb: 'Anything at all — the whole weave, drawing on every other thread.',
    emptyAsk: 'Say hello — this thread is for anything at all, and I draw on every other one here.',
    welcome: 'Welcome back. Say anything at all — this thread draws on every other one.',
  },
  {
    id: 'profile', label: 'Profile management', icon: 'profile',
    blurb: 'Your presence: page, story, what you offer.',
    emptyAsk: 'No page yet. Tell me about yourself and I’ll draft your profile and public page for you!',
    welcome: 'Welcome back to Profile management. Tell me what to change on your page and I’ll make it happen.',
  },
  {
    id: 'market', label: 'Marketplace', icon: 'store',
    blurb: 'What you’re offering and looking for.',
    emptyAsk: 'No Marketplace listings yet. Describe what you’d like to offer — or find — and I’ll draft the listings for you!',
    welcome: 'Welcome back to Marketplace. Let me know what you want to contribute to the commerce ecosystem.',
  },
  {
    id: 'events', label: 'Events', icon: 'rsvp',
    blurb: 'Gatherings you host or attend.',
    emptyAsk: 'No Events yet. Describe the Event(s) you want to create and I’ll generate them for you!',
    welcome: 'Welcome back to Events. Tell me about the next gathering and I’ll help you shape it.',
  },
  // COURSES (founder 2026-10-05: "I'm wanting the course builder to interact
  // intelligently with the Ai assistant, just like it does for Calendar and
  // Page builder") — describe a course in conversation and it lands in the
  // SAME collections row the Teach builder edits, modules pre-loaded.
  {
    id: 'courses', label: 'Courses', icon: 'graduation-cap',
    blurb: 'Teaching: your courses, their modules and sessions.',
    emptyAsk: 'No courses yet. Describe the course you want to teach — name, modules, who it’s for — and I’ll set it up so the Course Builder opens with it ready.',
    welcome: 'Welcome back to Courses. Tell me what to change on a course — or describe a new one — and it lands in your Course Builder.',
  },
  {
    id: 'calendar', label: 'Calendar', icon: 'calendar',
    blurb: 'Time, bookings, who can see what.',
    emptyAsk: 'Nothing on your Calendar yet. Tell me your hours, or what needs scheduling, and I’ll set it up with you!',
    welcome: 'Welcome back to Calendar. Tell me what to schedule, or how your hours should change.',
  },
  {
    id: 'concierge', label: 'Concierge', icon: 'concierge',
    blurb: 'Care — yours and the people you hold.',
    emptyAsk: 'No Concierge care set up yet. Tell me what wellbeing looks like for you right now, and we’ll begin your Web of Wellbeing together.',
    welcome: 'Welcome back to Concierge. Tell me how care is going, or what needs tending.',
  },
  // The MONEY COACH (founder 2026-09-13: "a money coach feels like a
  // relevant assistant and it can notice inefficiencies or suggest areas
  // to make more current-cy to help the person, financially").
  {
    id: 'currentcy', label: 'Current-cy', icon: 'currentcy',
    blurb: 'Your wallet — a money coach for the gift-and-exchange economy.',
    emptyAsk: 'No Current has moved for you yet. Tell me what you offer — or what you need — and we’ll find your first exchange together.',
    welcome: 'Welcome back to Current-cy. Ask what moved, or where you could earn more.',
  },
];

/** Which sections the member has actually SET UP (founder 2026-08-31: the
 *  thread rail's icons go gray for a section with nothing in it yet, and its
 *  greeting offers to create rather than welcoming back). "Set up" means real
 *  content in the section itself, not thread chatter about it. Any read that
 *  fails counts as not-set-up — gray is the honest fallback. */
export async function loadSectionPresence(me: string): Promise<Record<string, boolean>> {
  const any = async (q: PromiseLike<{ count: number | null }>) => {
    const { count } = await q;
    return (count ?? 0) > 0;
  };
  const [prof, market, events, avail, remind, care, ledger, teach] = await Promise.all([
    supabase.from('profiles').select('headline, bio, page').eq('id', me).maybeSingle(),
    any(supabase.from('posts').select('id', { count: 'exact', head: true })
      .eq('author_id', me).contains('service_areas', ['marketplace'])),
    any(supabase.from('posts').select('id', { count: 'exact', head: true })
      .eq('author_id', me).contains('service_areas', ['events'])),
    any(supabase.from('availability_windows').select('id', { count: 'exact', head: true })
      .eq('profile_id', me)),
    any(supabase.from('reminders').select('id', { count: 'exact', head: true })
      .eq('profile_id', me)),
    any(supabase.from('care_team_members').select('id', { count: 'exact', head: true })
      .or(`patient_id.eq.${me},caregiver_id.eq.${me}`)),
    any(supabase.from('ledger_entries').select('id', { count: 'exact', head: true })
      .or(`and(from_type.eq.profile,from_id.eq.${me}),and(to_type.eq.profile,to_id.eq.${me})`)),
    any(supabase.from('collections').select('id', { count: 'exact', head: true })
      .eq('owner_id', me).in('kind', ['course', 'path'])),
  ]);
  const p = (prof.data ?? null) as { headline: string | null; bio: string | null; page: Record<string, unknown> | null } | null;
  const pageBegun = !!(p && (p.headline || p.bio || (p.page && Object.keys(p.page).length > 0)));
  return {
    general: true,          // the front door is always open
    profile: pageBegun,
    market,
    events,
    calendar: avail || remind,
    concierge: care,
    // Lit once any Current has ever moved for them — a wallet with history.
    currentcy: ledger,
    // Lit once they TEACH something — a course or ordered collection of
    // their own (enrolling elsewhere is participation, not setup).
    courses: teach,
  };
}

export const threadLabel = (id: string) =>
  ASSISTANT_THREADS.find((t) => t.id === id)?.label ?? 'General';

/** A section key (sections.ts) → the thread its work belongs in. Anything
 *  without a thread of its own lands in general rather than inventing one. */
export function threadForSection(section?: string | null): string {
  if (!section) return 'general';
  const known = ASSISTANT_THREADS.some((t) => t.id === section);
  return known ? section : 'general';
}

/** The member's own feed relationship with Claude, oldest → newest.
 *  `thread` narrows to one thread; omit it for the whole relationship. */
export async function loadAssistantFeed(profileId: string, thread?: string): Promise<FeedPostRow[]> {
  let q = supabase
    .from('assistant_feed_posts')
    .select('id, author, body, source_post_id, thread, convo_id, created_at, attachments')
    .eq('profile_id', profileId);
  if (thread) q = q.eq('thread', thread);
  const { data, error } = await q.order('created_at', { ascending: true });
  if (error) throw error;
  return (data as FeedPostRow[] | null) ?? [];
}

/** UNSEEN REPLIES per thread (founder 2026-10-05: the rail's old tallies
 *  were LIFETIME entry counts wearing the notification-badge grammar —
 *  "old/stale notifications" that never cleared, promising news and opening
 *  onto history). A badge now means exactly one thing: Claude said something
 *  in that thread that you haven't been back for. Unseen = Claude entries
 *  newer than the LATER of your read cursor and your own last message there
 *  — the member-entry arm self-seeds threads from before the cursor table
 *  existed, so nothing badges retroactively. Opening a thread clears it via
 *  markThreadRead (the chat last_read_at pattern). */
export async function loadThreadBadges(profileId: string): Promise<Record<string, number>> {
  const [rowsRes, readsRes] = await Promise.all([
    supabase.from('assistant_feed_posts')
      .select('thread, author, created_at').eq('profile_id', profileId),
    supabase.from('assistant_thread_reads')
      .select('thread, read_at').eq('profile_id', profileId),
  ]);
  const reads = new Map(
    (((readsRes.data as { thread: string; read_at: string }[] | null) ?? []))
      .map((r) => [r.thread, new Date(r.read_at).getTime()]));
  const rows = (rowsRes.data as { thread: string; author: string; created_at: string }[] | null) ?? [];
  const lastMine = new Map<string, number>();
  rows.forEach((r) => {
    if (r.author !== 'member') return;
    const t = new Date(r.created_at).getTime();
    if (t > (lastMine.get(r.thread) ?? 0)) lastMine.set(r.thread, t);
  });
  // No cursor yet (history from before the table existed): only a RECENT
  // unanswered reply counts as news — a weeks-old last word is history, and
  // badging it would be the exact stale feeling this replaces. With a
  // cursor, the count is exact and persists like a chat pill should.
  const seededFloor = Date.now() - 7 * 86_400_000;
  const badges: Record<string, number> = {};
  rows.forEach((r) => {
    if (r.author !== 'claude') return;
    const cursor = reads.get(r.thread);
    const seenUpTo = cursor !== undefined
      ? Math.max(cursor, lastMine.get(r.thread) ?? 0)
      : Math.max(lastMine.get(r.thread) ?? 0, seededFloor);
    if (new Date(r.created_at).getTime() > seenUpTo) {
      badges[r.thread] = (badges[r.thread] ?? 0) + 1;
    }
  });
  return badges;
}

/** You've seen this thread up to now — opening it (and staying on it while
 *  a reply lands) bumps the cursor so its badge never lies. */
export async function markThreadRead(thread: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  await supabase.from('assistant_thread_reads')
    .upsert({ profile_id: user.id, thread, read_at: new Date().toISOString() });
}

/** Post into a thread of your own feed — the assistant_on_feed_post trigger
 *  answers in the same thread. `images` are already-uploaded URLs (pasted
 *  photos, founder 2026-08-22); they ride the existing attachments column
 *  in chat's {type:'photo', url} shape.
 *
 *  RETURNS THE INSERTED ROW (founder 2026-10-05: "I just typed to you and
 *  it disappeared"): the feed used to rely on the realtime echo alone to
 *  show your own message, so a dropped websocket made a safely-stored send
 *  vanish from the screen. The caller appends this row itself; the realtime
 *  handler's id-dedup makes the echo harmless when it does arrive. */
export async function postToAssistantFeed(
  body: string, sourcePostId?: string, thread = 'general', images?: string[],
  /** The conversation to continue. Omit to START a fresh conversation (an
   *  id is minted — the default for every door that opens a new exchange:
   *  brief composers, Share to Claude, search escalations). Pass null
   *  explicitly for a space build thread's continuous stream. */
  convoId?: string | null,
): Promise<FeedPostRow> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');
  const convo = convoId === undefined ? crypto.randomUUID() : convoId;
  const { data, error } = await supabase.from('assistant_feed_posts').insert({
    profile_id: user.id, author: 'member', body,
    source_post_id: sourcePostId ?? null, thread, convo_id: convo,
    attachments: images?.length ? images.map((url) => ({ type: 'photo', url })) : null,
  }).select('id, author, body, source_post_id, thread, convo_id, created_at, attachments').single();
  if (error) throw error;
  return data as FeedPostRow;
}

/** The thread's read cursor, for the conversation list's unread pills —
 *  a conversation is "unread" when it holds Claude entries newer than the
 *  later of this and your own last message in it. */
export async function loadThreadCursor(thread: string): Promise<number> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return 0;
  const { data } = await supabase.from('assistant_thread_reads')
    .select('read_at').eq('profile_id', user.id).eq('thread', thread).maybeSingle();
  const row = data as { read_at: string } | null;
  return row ? new Date(row.read_at).getTime() : 0;
}

/** Every thread's cursor at once — the General history log shows OTHER
 *  threads' conversations (founder 2026-10-06: "The general brain should
 *  cover all conversations"), and each pill must measure against ITS
 *  thread's cursor, not General's. */
export async function loadThreadCursors(): Promise<Record<string, number>> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return {};
  const { data } = await supabase.from('assistant_thread_reads')
    .select('thread, read_at').eq('profile_id', user.id);
  const out: Record<string, number> = {};
  (((data as { thread: string; read_at: string }[] | null) ?? []))
    .forEach((r) => { out[r.thread] = new Date(r.read_at).getTime(); });
  return out;
}

/** One conversation, grouped for a list row. */
export interface ConvoGroup {
  id: string;            // convo_id, or `loose:<thread>` for pre-id rows
  thread: string;
  entries: FeedPostRow[];
  title: string;
  last: FeedPostRow;
}

/** The self-organizing gap: entries closer together than this belong to one
 *  exchange (the backfill's rule, and the brief composer's continue rule —
 *  founder 2026-10-06: toggling away and back must not orphan the history). */
export const CONVO_GAP_MS = 6 * 3600 * 1000;

/** Group feed rows into conversations, newest activity first — the ONE
 *  grouping both the feed's list and the brief's history log render. */
export function groupConvos(rows: FeedPostRow[]): ConvoGroup[] {
  const by = new Map<string, FeedPostRow[]>();
  rows.forEach((p) => {
    const k = p.convo_id ?? `loose:${p.thread}`;
    const arr = by.get(k);
    if (arr) arr.push(p); else by.set(k, [p]);
  });
  return [...by.entries()].map(([id, entries]) => {
    const firstMember = entries.find((e) => e.author === 'member') ?? entries[0];
    const title = (firstMember.body || '').trim().replace(/\s+/g, ' ').slice(0, 80)
      || ((firstMember.attachments ?? []).some((a) => a.type === 'photo') ? 'A photo' : 'A shared post');
    return { id, thread: entries[0].thread, entries, title, last: entries[entries.length - 1] };
  }).sort((a, b) => +new Date(b.last.created_at) - +new Date(a.last.created_at));
}

/** The thread's newest entry — the brief composer continues a FRESH
 *  conversation instead of always starting a new one. */
export async function latestConvoIn(thread: string): Promise<{ convoId: string | null; at: number } | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase.from('assistant_feed_posts')
    .select('convo_id, created_at').eq('profile_id', user.id).eq('thread', thread)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  const row = data as { convo_id: string | null; created_at: string } | null;
  return row ? { convoId: row.convo_id, at: new Date(row.created_at).getTime() } : null;
}

/** What Claude is working from, when it works on your page — a receipt of its
 *  OWN inputs, not a description of you (founder 2026-08-11: "show the user
 *  the context Claude already has on the subject"). Read straight from the
 *  same rows the assistant's tools write to, so the card can't drift from
 *  what's actually there. */
export interface ProfileContext {
  tagline: string | null;
  storyWords: number;
  homeSummary: boolean;
  categories: string[];
  contactFilled: string[];
  contactEmpty: string[];
  canEdit: boolean;
}

const CONTACT_FIELDS = ['website', 'email', 'phone', 'booking', 'hours', 'address', 'instagram', 'facebook'];

export async function loadProfileContext(me: string): Promise<ProfileContext | null> {
  const { data } = await supabase.from('profiles')
    .select('page, contact, assistant_can_edit').eq('id', me).maybeSingle();
  if (!data) return null;
  const row = data as {
    page: { tagline?: string; story?: string; homeSummary?: string } | null;
    contact: Record<string, string> | null;
    assistant_can_edit?: boolean;
  };
  const page = row.page ?? {};
  const contact = row.contact ?? {};

  const { data: catRows } = await supabase.from('profile_categories')
    .select('categories(name)').eq('profile_id', me);
  const categories = ((catRows as { categories: { name: string } | null }[] | null) ?? [])
    .map((r) => r.categories?.name).filter((n): n is string => !!n);

  const story = (page.story ?? '').trim();
  return {
    tagline: page.tagline?.trim() || null,
    storyWords: story ? story.split(/\s+/).length : 0,
    homeSummary: !!page.homeSummary?.trim(),
    categories,
    contactFilled: CONTACT_FIELDS.filter((f) => contact[f]?.trim()),
    contactEmpty: CONTACT_FIELDS.filter((f) => !contact[f]?.trim()),
    canEdit: !!row.assistant_can_edit,
  };
}

// A SPACE'S BUILD THREAD (founder 2026-08-22, cashing in the note above):
// `space:<uuid>` in the same free-text thread column. Still the MEMBER's own
// rows by RLS — each admin holds their own private thread about the space;
// the shared, entity-owned thread is the per-entity AI Partner fabric, later.
// `space:<uuid>:currentcy` is the space's own Current-cy room (founder
// 2026-10-06: "link to the Ai assistant in countryman stable's account,
// which it will switch you to and then drop you in their current-cy chat")
// — the same free-text column, the same consent stack, money on the table
// instead of the page.
export const spaceThreadId = (spaceId: string, room?: 'currentcy') =>
  `space:${spaceId}${room ? `:${room}` : ''}`;
const SPACE_THREAD_RE = /^space:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?::(currentcy))?$/i;
export function spaceIdOfThread(thread: string): string | null {
  const m = SPACE_THREAD_RE.exec(thread);
  return m ? m[1] : null;
}
/** Which ROOM of the space a thread is — null = the build thread. */
export function spaceRoomOfThread(thread: string): 'currentcy' | null {
  const m = SPACE_THREAD_RE.exec(thread);
  return m?.[2]?.toLowerCase() === 'currentcy' ? 'currentcy' : null;
}

/** What Claude works from in a space's build thread — the space-side twin of
 *  ProfileContext, read from the same rows the space tools write to. */
export interface SpaceContext {
  name: string;
  kind: string;
  avatarUrl: string | null;
  tagline: string | null;
  storyWords: number;
  homeSummary: boolean;
  hasDescription: boolean;
  contactFilled: string[];
  contactEmpty: string[];
  /** The space's own assistant switch (backstage → Privacy). */
  aiEnabled: boolean;
  /** Steward of this space — participation-only help otherwise. */
  isAdmin: boolean;
  /** The member's hand-that-writes flag AND the space's switch, together. */
  canEdit: boolean;
}

export async function loadSpaceContext(me: string, spaceId: string): Promise<SpaceContext | null> {
  const [spRes, memRes, meRes] = await Promise.all([
    supabase.from('spaces')
      .select('name, kind, avatar_url, description, page, contact, assistant_enabled')
      .eq('id', spaceId).maybeSingle(),
    supabase.from('space_members')
      .select('role').eq('space_id', spaceId).eq('profile_id', me).maybeSingle(),
    supabase.from('profiles').select('assistant_can_edit').eq('id', me).maybeSingle(),
  ]);
  const sp = spRes.data as {
    name: string; kind: string; avatar_url: string | null; description: string | null;
    page: { tagline?: string; story?: string; homeSummary?: string } | null;
    contact: Record<string, string> | null;
    assistant_enabled: boolean | null;
  } | null;
  if (!sp) return null;
  const role = (memRes.data as { role?: string } | null)?.role;
  const isAdmin = role === 'admin' || role === 'super_admin';
  const page = sp.page ?? {};
  const contact = sp.contact ?? {};
  const story = (page.story ?? '').trim();
  const aiEnabled = sp.assistant_enabled !== false;
  return {
    name: sp.name,
    kind: sp.kind,
    avatarUrl: sp.avatar_url,
    tagline: page.tagline?.trim() || null,
    storyWords: story ? story.split(/\s+/).length : 0,
    homeSummary: !!page.homeSummary?.trim(),
    hasDescription: !!sp.description?.trim(),
    contactFilled: CONTACT_FIELDS.filter((f) => contact[f]?.trim()),
    contactEmpty: CONTACT_FIELDS.filter((f) => !contact[f]?.trim()),
    aiEnabled,
    isAdmin,
    canEdit: aiEnabled && isAdmin
      && !!(meRes.data as { assistant_can_edit?: boolean } | null)?.assistant_can_edit,
  };
}

/** Whether the member has actually used their Claude feed — a real post,
 *  not just having seen the row. */
export async function hasClaudeFeedActivity(me: string): Promise<boolean> {
  const { data } = await supabase.from('assistant_feed_posts').select('id').eq('profile_id', me).limit(1).maybeSingle();
  return !!data;
}
