import { supabase } from './supabase';
import type { GeoPoint } from './geoApi';

// ─── Home location + location_shares (founder privacy model; thread #9) ──────
// home_* columns are NOT in profiles' column grant — the owner reads their own
// via my_home(), and everyone else only ever sees what mappable_members()
// resolves for THEM (hidden by default; 'area' = town label + ~5km grid).

export type LocationLevel = 'hidden' | 'area' | 'exact';

export interface MyHome {
  location: string;
  geo: GeoPoint | null;
  area: string;
}

export async function loadMyHome(): Promise<MyHome> {
  const { data, error } = await supabase.rpc('my_home');
  if (error) { console.warn('my_home:', error.message); return { location: '', geo: null, area: '' }; }
  const row = (data as {
    home_location: string | null; home_lat: number | null;
    home_lng: number | null; home_area: string | null;
  }[] | null)?.[0];
  if (!row) return { location: '', geo: null, area: '' };
  return {
    location: row.home_location ?? '',
    geo: row.home_lat != null && row.home_lng != null ? { lat: row.home_lat, lng: row.home_lng } : null,
    area: row.home_area ?? '',
  };
}

export async function saveMyHome(me: string, home: MyHome): Promise<void> {
  const { error } = await supabase.from('profiles').update({
    home_location: home.location.trim() || null,
    home_lat: home.geo?.lat ?? null,
    home_lng: home.geo?.lng ?? null,
    home_area: home.area.trim() || null,
  }).eq('id', me);
  if (error) throw error;
}

// ─── Share rules (calendar_shares pattern, kind='home') ──────────────────────

export interface LocationShareRule {
  id: string;
  audience_type: 'everyone' | 'space' | 'profile';
  audience_space_id: string | null;
  audience_profile_id: string | null;
  level: LocationLevel;
  space?: { name: string } | null;
  profile?: { full_name: string | null } | null;
}

export type ShareAudience =
  | { type: 'everyone' }
  | { type: 'space'; spaceId: string }
  | { type: 'profile'; profileId: string };

export async function loadMyLocationShares(me: string): Promise<LocationShareRule[]> {
  const { data, error } = await supabase
    .from('location_shares')
    .select('id, audience_type, audience_space_id, audience_profile_id, level, space:spaces(name), profile:profiles!location_shares_audience_profile_id_fkey(full_name)')
    .eq('owner_id', me)
    .eq('kind', 'home')
    .order('created_at');
  if (error) { console.warn('loadMyLocationShares:', error.message); return []; }
  return (data as unknown as LocationShareRule[] | null) ?? [];
}

/** Delete-then-insert to satisfy the per-audience unique index. */
export async function upsertLocationShare(me: string, audience: ShareAudience, level: LocationLevel): Promise<void> {
  const row = {
    owner_id: me,
    kind: 'home',
    audience_type: audience.type,
    audience_space_id: audience.type === 'space' ? audience.spaceId : null,
    audience_profile_id: audience.type === 'profile' ? audience.profileId : null,
    level,
  };
  let del = supabase.from('location_shares').delete()
    .eq('owner_id', me).eq('kind', 'home').eq('audience_type', audience.type);
  if (audience.type === 'space') del = del.eq('audience_space_id', audience.spaceId);
  if (audience.type === 'profile') del = del.eq('audience_profile_id', audience.profileId);
  await del;
  const { error } = await supabase.from('location_shares').insert(row);
  if (error) throw error;
}

export async function deleteLocationShare(id: string): Promise<void> {
  const { error } = await supabase.from('location_shares').delete().eq('id', id);
  if (error) throw error;
}

// ─── People on the map (per-viewer resolution happens server-side) ───────────

/** Member-facing area label (founder, 2026-07-17): the town reads as a
 *  place, not an apology — "Bailey, Colorado", never
 *  "Near Bailey, Colorado 80421, United States". */
export function areaLabel(place: string | null): string | null {
  if (!place) return null;
  const trimmed = place
    .replace(/\b\d{5}(-\d{4})?\b/g, '')
    .replace(/,\s*United States\s*$/i, '')
    .replace(/\s+,/g, ',')
    .replace(/,\s*,/g, ',')
    .replace(/[,\s]+$/, '')
    .trim();
  return trimmed || null;
}

export interface MappableMember {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  level: LocationLevel;
  lat: number;
  lng: number;
  place: string | null;
}

export async function loadMappableMembers(): Promise<MappableMember[]> {
  const { data, error } = await supabase.rpc('mappable_members');
  if (error) { console.warn('mappable_members:', error.message); return []; }
  return (data as MappableMember[] | null) ?? [];
}
