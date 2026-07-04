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
  { value: 'events', label: 'Events', icon: 'calendar' },
  { value: 'places', label: 'Places', icon: 'location' },
  { value: 'library', label: 'Library', icon: 'book' },
  { value: 'people', label: 'People', icon: 'user-multiple' },
];

export function serviceAreaIcon(area: ServiceArea | null): IconName | null {
  return SERVICE_AREAS.find((a) => a.value === area)?.icon ?? null;
}

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
  author: { full_name: string | null; handle: string | null } | null;
  author_space: { name: string; kind: string } | null;
};

/** Every area a post lives in (new array first, legacy single as fallback). */
export function postAreas(p: Pick<FeedPost, 'service_area' | 'service_areas'>): ServiceArea[] {
  if (p.service_areas?.length) return p.service_areas;
  return p.service_area ? [p.service_area] : [];
}

// RLS scopes this to what the viewer may see: public + their spaces + mycelium + own.
export async function loadFeed(): Promise<FeedPost[]> {
  const { data, error } = await supabase
    .from('posts')
    .select('id, author_id, author_space_id, title, body, content_type, service_area, service_areas, visibility, is_public, to_mycelium, audience_space_ids, image_url, details, created_at, author:profiles!posts_author_id_fkey(full_name, handle), author_space:spaces!posts_author_space_id_fkey(name, kind)')
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) { console.error('loadFeed', error); return []; }
  return (data as unknown as FeedPost[]) ?? [];
}
