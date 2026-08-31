import { supabase } from './supabase';

/** A photo pasted into the feed — the same shape chat attachments wear. */
export interface FeedAttachment { type: 'photo'; url: string }

export interface FeedPostRow {
  id: string;
  author: 'member' | 'claude';
  body: string;
  source_post_id: string | null;
  thread: string;
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
  const [prof, market, events, avail, remind, care] = await Promise.all([
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
    .select('id, author, body, source_post_id, thread, created_at, attachments')
    .eq('profile_id', profileId);
  if (thread) q = q.eq('thread', thread);
  const { data, error } = await q.order('created_at', { ascending: true });
  if (error) throw error;
  return (data as FeedPostRow[] | null) ?? [];
}

/** Which threads this member has actually used — so the rail can lead with
 *  the live ones rather than showing six empty doors. */
export async function loadThreadCounts(profileId: string): Promise<Record<string, number>> {
  const { data } = await supabase
    .from('assistant_feed_posts').select('thread').eq('profile_id', profileId);
  const counts: Record<string, number> = {};
  ((data as { thread: string }[] | null) ?? []).forEach((r) => {
    counts[r.thread] = (counts[r.thread] ?? 0) + 1;
  });
  return counts;
}

/** Post into a thread of your own feed — the assistant_on_feed_post trigger
 *  answers in the same thread. `images` are already-uploaded URLs (pasted
 *  photos, founder 2026-08-22); they ride the existing attachments column
 *  in chat's {type:'photo', url} shape. */
export async function postToAssistantFeed(
  body: string, sourcePostId?: string, thread = 'general', images?: string[],
): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');
  const { error } = await supabase.from('assistant_feed_posts').insert({
    profile_id: user.id, author: 'member', body,
    source_post_id: sourcePostId ?? null, thread,
    attachments: images?.length ? images.map((url) => ({ type: 'photo', url })) : null,
  });
  if (error) throw error;
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
export const spaceThreadId = (spaceId: string) => `space:${spaceId}`;
export function spaceIdOfThread(thread: string): string | null {
  const m = /^space:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(thread);
  return m ? m[1] : null;
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
