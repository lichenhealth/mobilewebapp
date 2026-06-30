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
  visibility: Visibility;
  space_id?: string | null;
  service_area?: ServiceArea | null;
  details?: Record<string, unknown>;
};

export async function createPost(input: NewPost) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');
  const { data, error } = await supabase.from('posts').insert({
    author_id: user.id,
    body: input.body.trim(),
    title: input.title?.trim() || null,
    content_type: input.content_type,
    visibility: input.visibility,
    space_id: input.space_id ?? null,
    service_area: input.service_area ?? null,
    details: input.details ?? {},
  }).select('id').single();
  if (error) throw error;
  return data;
}

export type FeedPost = {
  id: string;
  author_id: string;
  title: string | null;
  body: string;
  content_type: ContentType;
  service_area: ServiceArea | null;
  visibility: Visibility;
  details: Record<string, unknown>;
  created_at: string;
  author: { full_name: string | null; handle: string | null } | null;
};

// RLS scopes this to what the viewer may see: public + their spaces + mycelium + own.
export async function loadFeed(): Promise<FeedPost[]> {
  const { data, error } = await supabase
    .from('posts')
    .select('id, author_id, title, body, content_type, service_area, visibility, details, created_at, author:profiles!posts_author_id_fkey(full_name, handle)')
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) { console.error('loadFeed', error); return []; }
  return (data as unknown as FeedPost[]) ?? [];
}
