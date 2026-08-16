import { supabase } from './supabase';
import { loadMyHidden } from './hiddenApi';
import type { IconName } from '../components/Icon';

export type Visibility = 'public' | 'mycelium' | 'space';
export type ContentType = 'social' | 'creative' | 'educational' | 'actionable' | 'qa';
export type ServiceArea =
  | 'marketplace' | 'work' | 'courses' | 'food' | 'art' | 'events' | 'places' | 'library' | 'people'
  | 'travel';

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
  // Travel (founder 2026-07-28): stays, rides, and getting there together.
  { value: 'travel', label: 'Travel', icon: 'plane' },
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
  /** Posting AS a being you steward (Tango, a cactus). */
  authorBeingId?: string | null;
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
    // Acting as a being you steward puts THEM in the author seat — the RLS
    // policy delegates via is_entity_steward, mirroring how author_space_id
    // has always delegated via is_space_admin (founder 2026-08-05).
    author_id: input.authorBeingId ?? user.id,
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

/** Author edits their post in place. Recomputes the SAME legacy bridge
 *  columns createPost writes (visibility / space_id / service_area) so the
 *  v1↔v2 sync trigger never sees them drift. */
export async function updatePost(id: string, input: NewPost): Promise<void> {
  const visibility: Visibility = input.isPublic ? 'public' : input.toMycelium ? 'mycelium' : 'space';
  const { error } = await supabase.from('posts').update({
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
  }).eq('id', id);
  if (error) throw error;
}

export async function deletePost(id: string): Promise<void> {
  const { error } = await supabase.from('posts').delete().eq('id', id);
  if (error) throw error;
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
    lat: number | null; lng: number | null;
  } | null;
};

/** Every area a post lives in (new array first, legacy single as fallback). */
export function postAreas(p: Pick<FeedPost, 'service_area' | 'service_areas'>): ServiceArea[] {
  if (p.service_areas?.length) return p.service_areas;
  return p.service_area ? [p.service_area] : [];
}

// ─── RSVP (Book on Free/Trade event posts; the calendar event is the container)
// Upsert so switching Going ↔ Maybe (or re-RSVPing after an invite) just works.
export async function rsvpToEvent(eventId: string, me: string, status: 'going' | 'tentative' = 'going'): Promise<void> {
  const { error } = await supabase.from('event_attendees')
    .upsert({ event_id: eventId, profile_id: me, invited_by: me, status }, { onConflict: 'event_id,profile_id' });
  if (error) throw error;
}
export async function unRsvp(eventId: string, me: string): Promise<void> {
  const { error } = await supabase.from('event_attendees')
    .delete().eq('event_id', eventId).eq('profile_id', me);
  if (error) throw error;
}
/** My RSVP status per linked event (absent = no attendee row). */
export type MyRsvpStatus = 'invited' | 'going' | 'tentative' | 'declined';
export async function loadMyRsvpStatuses(eventIds: string[], me: string): Promise<Map<string, MyRsvpStatus>> {
  if (eventIds.length === 0) return new Map();
  const { data } = await supabase.from('event_attendees')
    .select('event_id, status').eq('profile_id', me).in('event_id', eventIds);
  const map = new Map<string, MyRsvpStatus>();
  for (const r of (data as { event_id: string; status: MyRsvpStatus }[] | null) ?? []) {
    map.set(r.event_id, r.status);
  }
  return map;
}

const FEED_SELECT = 'id, author_id, author_space_id, title, body, content_type, service_area, service_areas, visibility, is_public, to_mycelium, audience_space_ids, image_url, details, created_at, author:profiles!posts_author_id_fkey(full_name, handle, avatar_url), author_space:spaces!posts_author_space_id_fkey(name, kind), event_category, event_mode, linked_event_id, linked_event:events!posts_linked_event_id_fkey(id, start_date, end_date, all_day, start_min, end_min, recurrence, lat, lng)';

/** A set of posts by id (the Saved shelf). RLS applies — hidden ones drop. */
export async function loadPostsByIds(ids: string[]): Promise<FeedPost[]> {
  if (ids.length === 0) return [];
  const { data, error } = await supabase.from('posts').select(FEED_SELECT).in('id', ids);
  if (error) { console.warn('loadPostsByIds', error.message); return []; }
  return (data as unknown as FeedPost[] | null) ?? [];
}

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
/** An entity's profile feed, newest first (Figma 286-16377 / 286-11770).
 *  PEOPLE: authored-by, as themselves (author_id stays the human even when
 *  acting as a space, so their profile shows only what they posted as
 *  THEMSELVES). SPACES: the WALL — everything flowing within the space:
 *  posts authored AS it plus posts ADDRESSED to it (audience includes it).
 *  RLS still scopes every row to what the viewer may see. */
export async function loadAuthorFeed(by: { profileId?: string; spaceId?: string }): Promise<FeedPost[]> {
  let q = supabase.from('posts').select(FEED_SELECT);
  if (by.spaceId) q = q.or(`author_space_id.eq.${by.spaceId},audience_space_ids.cs.{${by.spaceId}}`);
  else if (by.profileId) q = q.eq('author_id', by.profileId).is('author_space_id', null);
  else return [];
  const [{ data, error }, hidden] = await Promise.all([
    q.order('created_at', { ascending: false }).limit(50),
    loadMyHidden(),
  ]);
  if (error) { console.warn('loadAuthorFeed:', error.message); return []; }
  return (((data as unknown as FeedPost[]) ?? []).filter((p) => !hidden.has(p.id)));
}

/** Does this space have any real gatherings? (founder 2026-08-07: "add icons
 *  to a community, group or org page when they start using the feature... if
 *  someone never uses Work, that icon will never show up on their profile".)
 *  One row is enough to answer it — the full list waits until the door opens. */
export async function spaceHasEvents(spaceId: string): Promise<boolean> {
  const { data, error } = await supabase.from('posts')
    .select('id')
    .or(`author_space_id.eq.${spaceId},audience_space_ids.cs.{${spaceId}}`)
    .not('linked_event_id', 'is', null)
    .limit(1);
  if (error) return false;
  return ((data ?? []).length > 0);
}

/** @param opts.river  Drop QUIET posts — the ones whose author asked not to
 *  generate a feed story (founder 2026-08-07: "you may not want to generate 45
 *  stories when you share a certain product set to marketplace").
 *
 *  OPT-IN, and it has to be: loadFeed is the shared source for Events,
 *  Marketplace, AreaFeed, Maps and smart search as well as the two feeds.
 *  Filtering it centrally made a quiet event vanish from /events itself, which
 *  is the opposite of the point — quiet means "not a story on Home", never
 *  "hidden". Only Home and My-celium pass river: true.
 *
 *  Filtered SERVER-side: 45 imported essays dropped in the client would eat the
 *  whole 50-row page and leave the feed looking empty. */
export async function loadFeed(limit = 50, opts: { river?: boolean } = {}): Promise<FeedPost[]> {
  // Hidden posts drop here, centrally — every feed surface inherits it.
  let q = supabase.from('posts').select(FEED_SELECT);
  if (opts.river) {
    q = q.or('details->>quiet.is.null,details->>quiet.neq.true');
    // COURSE MATERIAL IS NOT A STORY (founder 2026-08-15): "administrative
    // and managerial work around posting courses, etc, shouldn't be in there
    // at all, ever. Only someone actively deciding to post something to the
    // feed should render a story." Publishing a module is filing material in
    // a room, not addressing the network — so it never enters the river. It
    // still lives in Courses, in its collection, in search and in the
    // author's Drive. The one exception is a DOOR post (details.collectionId)
    // — the thing Compose mints when you deliberately announce a collection.
    // That IS the decision to post, so it keeps its place.
    q = q.or('service_areas.not.cs.{courses},details->>collectionId.not.is.null');
  }
  const [{ data, error }, hidden] = await Promise.all([
    q.order('created_at', { ascending: false }).limit(limit),
    loadMyHidden(),
  ]);
  if (error) { console.error('loadFeed', error); return []; }
  return (((data as unknown as FeedPost[]) ?? []).filter((p) => !hidden.has(p.id)));
}

/** Names for a batch of spaces — the provenance line's "where it went"
 *  (founder 2026-07-28). One query per feed load, ids the viewer can read. */
export async function loadSpaceNames(ids: string[]): Promise<Map<string, string>> {
  const uniq = [...new Set(ids)].filter(Boolean);
  if (!uniq.length) return new Map();
  const { data } = await supabase.from('spaces').select('id, name').in('id', uniq);
  return new Map(((data as { id: string; name: string }[] | null) ?? []).map((s) => [s.id, s.name]));
}
