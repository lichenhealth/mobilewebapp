import { supabase } from './supabase';

export interface FeedPostRow {
  id: string;
  author: 'member' | 'claude';
  body: string;
  source_post_id: string | null;
  thread: string;
  created_at: string;
}

// THREADS (founder 2026-08-11) — "since we're weaving a tapestry": the
// assistant keeps a thread per part of the platform, so work stays where it
// belongs. Press AI inside Marketplace and what you say is logged in the
// Marketplace thread. Each thread weaves into its section's tapestry, and
// those into the whole ecosystem — which is what General reads across.
// (A space-scoped thread — Countryman Stables' Marketplace — is the same
// idea one level in; the column is free text so it needs no migration.)
export interface AssistantThread { id: string; label: string; blurb: string }

export const ASSISTANT_THREADS: AssistantThread[] = [
  { id: 'general', label: 'General', blurb: 'Anything at all — the whole weave, drawing on every other thread.' },
  { id: 'profile', label: 'Profile management', blurb: 'Your presence: page, story, what you offer.' },
  { id: 'market', label: 'Marketplace', blurb: 'What you’re offering and looking for.' },
  { id: 'events', label: 'Events', blurb: 'Gatherings you host or attend.' },
  { id: 'calendar', label: 'Calendar', blurb: 'Time, bookings, who can see what.' },
  { id: 'concierge', label: 'Concierge', blurb: 'Care — yours and the people you hold.' },
];

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
    .select('id, author, body, source_post_id, thread, created_at')
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
 *  answers in the same thread. */
export async function postToAssistantFeed(
  body: string, sourcePostId?: string, thread = 'general',
): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');
  const { error } = await supabase.from('assistant_feed_posts').insert({
    profile_id: user.id, author: 'member', body,
    source_post_id: sourcePostId ?? null, thread,
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
      .select('name, kind, description, page, contact, assistant_enabled')
      .eq('id', spaceId).maybeSingle(),
    supabase.from('space_members')
      .select('role').eq('space_id', spaceId).eq('profile_id', me).maybeSingle(),
    supabase.from('profiles').select('assistant_can_edit').eq('id', me).maybeSingle(),
  ]);
  const sp = spRes.data as {
    name: string; kind: string; description: string | null;
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
