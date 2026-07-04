import { supabase } from './supabase';
import type { IconName } from '../components/Icon';

export type Visibility = 'public' | 'mycelium' | 'space';
export type ContentType = 'social' | 'creative' | 'educational' | 'actionable' | 'qa';
export type ServiceArea =
  | 'marketplace' | 'work' | 'courses' | 'food' | 'art' | 'events' | 'places' | 'library' | 'people';

export const CONTENT_TYPES: { value: ContentType; label: string }[] = [
  { value: 'social', label: 'Social' },
  { value: 'creative', label: 'Creative' },
  { value: 'educational', label: 'Educational' },
  { value: 'actionable', label: 'Actionable' },
  { value: 'qa', label: 'Q&A' },
];

export const SERVICE_AREAS: { value: ServiceArea; label: string; icon: IconName }[] = [
  { value: 'marketplace', label: 'Marketplace', icon: 'store' },
  { value: 'work', label: 'Work', icon: 'briefcase' },
  { value: 'courses', label: 'Courses', icon: 'graduation-cap' },
  { value: 'food', label: 'Food & Nutrition', icon: 'fork-spoon' },
  { value: 'art', label: 'Art', icon: 'palette' },
  { value: 'events', label: 'Events', icon: 'rsvp' },
  { value: 'places', label: 'Places', icon: 'location' },
  { value: 'library', label: 'Library', icon: 'book' },
  { value: 'people', label: 'People', icon: 'user-multiple' },
];

export function serviceAreaIcon(area: ServiceArea | null): IconName | null {
  return SERVICE_AREAS.find((a) => a.value === area)?.icon ?? null;
}

// ─── Events (event posts linked to real calendar events) ─────────────────────
export type EventCategory = 'social' | 'work_charity' | 'learning' | 'experiences';
export type EventMode = 'free' | 'trade' | 'paid';
export const EVENT_CATEGORIES: { value: EventCategory; label: string }[] = [
  { value: 'social', label: 'Social' },
  { value: 'work_charity', label: 'Work / Charity' },
  { value: 'learning', label: 'Learning' },
  { value: 'experiences', label: 'Experiences' },
];
export const EVENT_MODES: { value: EventMode; label: string; icon: IconName }[] = [
  { value: 'free', label: 'Free', icon: 'heart-line' },
  { value: 'trade', label: 'Trade', icon: 'trade' },
  { value: 'paid', label: 'Paid', icon: 'dollar' },
];

export type NewPost = {
  body: string;
  title?: string;
  content_type: ContentType;
  // v2 audiences: any combination (Everyone is UI-exclusive).
  isPublic: boolean;
  toMycelium: boolean;
  audienceSpaceIds: string[];
  // v2: a post can live in several areas at once (Courses AND Marketplace).
  serviceAreas: ServiceArea[];
  // v2: posted as a space you admin ("acting as"); null = personal.
  authorSpaceId?: string | null;
  // Events: category + mode + the linked calendar event (RSVP container).
  eventCategory?: EventCategory | null;
  eventMode?: EventMode | null;
  linkedEventId?: string | null;
  image_url?: string | null;
  details?: Record<string, unknown>;
};

// Upload a file (or recorded blob) into the post-media bucket; returns a public URL.
export async function uploadMedia(file: Blob, ext: string): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');
  const path = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const { error } = await supabase.storage.from('post-media').upload(path, file);
  if (error) throw error;
  return supabase.storage.from('post-media').getPublicUrl(path).data.publicUrl;
}

export async function createPost(input: NewPost) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');
  // Legacy columns still written (visibility / space_id / service_area) so any
  // not-yet-refreshed client keeps rendering new posts during the transition;
  // the DB bridge trigger backstops both directions.
  const visibility: Visibility = input.isPublic ? 'public' : input.toMycelium ? 'mycelium' : 'space';
  const { data, error } = await supabase.from('posts').insert({
    author_id: user.id,
    author_space_id: input.authorSpaceId ?? null,
    event_category: input.eventCategory ?? null,
    event_mode: input.eventMode ?? null,
    linked_event_id: input.linkedEventId ?? null,
    body: input.body.trim(),
    title: input.title?.trim() || null,
    content_type: input.content_type,
    is_public: input.isPublic,
    to_mycelium: input.toMycelium,
    audience_space_ids: input.audienceSpaceIds,
    visibility,
    space_id: visibility === 'space' ? (input.audienceSpaceIds[0] ?? null) : null,
    service_areas: input.serviceAreas,
    service_area: input.serviceAreas[0] ?? null,
    image_url: input.image_url ?? null,
    details: input.details ?? {},
  }).select('id').single();
  if (error) throw error;
  return data;
}

export type FeedPost = {
  id: string;
  author_id: string;
  author_space_id: string | null;
  title: string | null;
  body: string;
  content_type: ContentType;
  service_area: ServiceArea | null;      // legacy single (kept during transition)
  service_areas: ServiceArea[];
  visibility: Visibility;                // legacy (kept during transition)
  is_public: boolean;
  to_mycelium: boolean;
  audience_space_ids: string[];
  image_url: string | null;
  details: Record<string, unknown>;
  created_at: string;
  author: { full_name: string | null; handle: string | null; avatar_url: string | null } | null;
  author_space: { name: string; kind: string } | null;
  event_category: EventCategory | null;
  event_mode: EventMode | null;
  linked_event_id: string | null;
  linked_event: {
    id: string; start_date: string; end_date: string; all_day: boolean;
    start_min: number | null; end_min: number | null;
    recurrence: import('./recurrence').Recurrence | null;
  } | null;
};

/** Every area a post lives in (new array first, legacy single as fallback). */
export function postAreas(p: Pick<FeedPost, 'service_area' | 'service_areas'>): ServiceArea[] {
  if (p.service_areas?.length) return p.service_areas;
  return p.service_area ? [p.service_area] : [];
}

// ─── RSVP (Book on Free/Trade event posts; the calendar event is the container)
export async function rsvpToEvent(eventId: string, me: string): Promise<void> {
  const { error } = await supabase.from('event_attendees')
    .insert({ event_id: eventId, profile_id: me, invited_by: me, status: 'going' });
  if (error && !/duplicate|unique/i.test(error.message)) throw error;
}
export async function unRsvp(eventId: string, me: string): Promise<void> {
  const { error } = await supabase.from('event_attendees')
    .delete().eq('event_id', eventId).eq('profile_id', me);
  if (error) throw error;
}
/** Which of these linked events am I already going to? */
export async function loadMyRsvps(eventIds: string[], me: string): Promise<Set<string>> {
  if (eventIds.length === 0) return new Set();
  const { data } = await supabase.from('event_attendees')
    .select('event_id').eq('profile_id', me).in('event_id', eventIds).neq('status', 'declined');
  return new Set(((data as { event_id: string }[] | null) ?? []).map((r) => r.event_id));
}

const FEED_SELECT = 'id, author_id, author_space_id, title, body, content_type, service_area, service_areas, visibility, is_public, to_mycelium, audience_space_ids, image_url, details, created_at, author:profiles!posts_author_id_fkey(full_name, handle, avatar_url), author_space:spaces!posts_author_space_id_fkey(name, kind), event_category, event_mode, linked_event_id, linked_event:events!posts_linked_event_id_fkey(id, start_date, end_date, all_day, start_min, end_min, recurrence)';

/** One post (the event page's About). RLS applies. */
export async function loadPost(id: string): Promise<FeedPost | null> {
  const { data, error } = await supabase.from('posts').select(FEED_SELECT).eq('id', id).maybeSingle();
  if (error) { console.warn('loadPost', error.message); return null; }
  return (data as unknown as FeedPost | null) ?? null;
}

/** Host updates: later posts linked to the same calendar event. */
export async function loadEventUpdates(eventId: string, excludePostId: string): Promise<FeedPost[]> {
  const { data, error } = await supabase
    .from('posts').select(FEED_SELECT)
    .eq('linked_event_id', eventId).neq('id', excludePostId)
    .order('created_at', { ascending: false });
  if (error) { console.warn('loadEventUpdates', error.message); return []; }
  return (data as unknown as FeedPost[] | null) ?? [];
}

// RLS scopes this to what the viewer may see: public + their spaces + mycelium + own.
export async function loadFeed(): Promise<FeedPost[]> {
  const { data, error } = await supabase
    .from('posts')
    .select(FEED_SELECT)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) { console.error('loadFeed', error); return []; }
  return (data as unknown as FeedPost[]) ?? [];
}
