import { supabase } from './supabase';
import type { GeoPoint } from './geoApi';
import { downscaleImage } from './avatarApi';

// ─── Spaces on the map (Maps v1.1) ────────────────────────────────────────────
// Any space an admin gives a picked-suggestion address gets coordinates;
// place + organization kinds render as pins today (community/group locations
// activate with the location-privacy phase — CLAUDE.md thread #9).

export type SpaceKind = 'organization' | 'community' | 'group' | 'place';

export interface MappableSpace {
  id: string;
  name: string;
  kind: SpaceKind;
  location: string | null;
  lat: number | null;
  lng: number | null;
}

/** Pinnable spaces: any kind whose admins set a picked-suggestion address.
 *  (Finer per-kind visibility rules arrive with the location-shares phase.) */
export async function loadMappableSpaces(): Promise<MappableSpace[]> {
  const { data, error } = await supabase
    .from('spaces')
    .select('id, name, kind, location, lat, lng')
    .not('lat', 'is', null);
  if (error) { console.warn('loadMappableSpaces:', error.message); return []; }
  return (data as MappableSpace[] | null) ?? [];
}

/** Every space I can administer (admin or super_admin), any kind. */
export async function listMyAdminSpaces(me: string): Promise<MappableSpace[]> {
  const { data, error } = await supabase
    .from('space_members')
    .select('role, spaces(id, name, kind, location, lat, lng)')
    .eq('profile_id', me)
    .in('role', ['admin', 'super_admin']);
  if (error) { console.warn('listMyAdminSpaces:', error.message); return []; }
  return (((data as unknown as { spaces: MappableSpace | null }[] | null) ?? [])
    .map((r) => r.spaces)
    .filter((s): s is MappableSpace => !!s))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Admin sets a space's human address + (when a suggestion was picked) pin. */
export async function setSpaceLocation(id: string, location: string, geo: GeoPoint | null): Promise<void> {
  const { error } = await supabase.from('spaces').update({
    location: location.trim() || null,
    lat: geo?.lat ?? null,
    lng: geo?.lng ?? null,
  }).eq('id', id);
  if (error) throw error;
}

// ─── Space profiles (/spaces/:id) ─────────────────────────────────────────────

export interface SpaceProfileRow {
  id: string;
  kind: SpaceKind;
  name: string;
  handle: string | null;
  description: string | null;
  avatar_url: string | null;
  location: string | null;
  lat: number | null;
  lng: number | null;
  created_by: string | null;
}

export async function loadSpaceProfile(id: string): Promise<SpaceProfileRow | null> {
  const { data, error } = await supabase
    .from('spaces')
    .select('id, kind, name, handle, description, avatar_url, location, lat, lng, created_by')
    .eq('id', id)
    .maybeSingle();
  if (error) { console.warn('loadSpaceProfile:', error.message); return null; }
  return (data as SpaceProfileRow | null) ?? null;
}

export type SpaceRole = 'super_admin' | 'admin' | 'member';
export interface SpaceMemberRow {
  profile_id: string;
  role: SpaceRole;
  profile: { full_name: string | null; avatar_url: string | null } | null;
}

const ROLE_ORDER: Record<SpaceRole, number> = { super_admin: 0, admin: 1, member: 2 };

export async function loadSpaceMembers(id: string): Promise<SpaceMemberRow[]> {
  const { data, error } = await supabase
    .from('space_members')
    .select('profile_id, role, profile:profiles(full_name, avatar_url)')
    .eq('space_id', id);
  if (error) { console.warn('loadSpaceMembers:', error.message); return []; }
  return (((data as unknown as SpaceMemberRow[] | null) ?? []))
    .sort((a, b) =>
      ROLE_ORDER[a.role] - ROLE_ORDER[b.role]
      || (a.profile?.full_name ?? '').localeCompare(b.profile?.full_name ?? ''));
}

/** The space's chat room id (every space gets one at creation via trigger).
 *  chats RLS is member-gated, so non-members simply get null — the Chat
 *  circle on the profile hides itself. */
export async function loadSpaceChatId(spaceId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('chats')
    .select('id')
    .eq('space_id', spaceId)
    .maybeSingle();
  if (error) { console.warn('loadSpaceChatId:', error.message); return null; }
  return (data as { id: string } | null)?.id ?? null;
}

/** Admin edits the space's public profile (name/description/avatar/location). */
export async function updateSpaceProfile(id: string, patch: {
  name?: string;
  description?: string | null;
  avatar_url?: string | null;
  location?: string | null;
  lat?: number | null;
  lng?: number | null;
}): Promise<void> {
  const { error } = await supabase.from('spaces').update(patch).eq('id', id);
  if (error) throw error;
}

/** Space avatar: uploaded into the ADMIN'S OWN avatars folder (the bucket's
 *  insert policy is per-user); the space row just points at the public URL. */
export async function uploadSpaceAvatar(uid: string, spaceId: string, file: File): Promise<string> {
  const blob = await downscaleImage(file);
  const path = `${uid}/space-${spaceId}-${Date.now()}.jpg`;
  const { error } = await supabase.storage.from('avatars').upload(path, blob, { contentType: 'image/jpeg' });
  if (error) throw error;
  return supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl;
}

/** Create a place/organization with its location in one go (creator becomes
 *  super_admin via the handle_new_space trigger). Returns the new space id. */
export async function createSpaceWithLocation(
  me: string, name: string, kind: SpaceKind, location: string, geo: GeoPoint | null,
): Promise<string> {
  const { data, error } = await supabase.from('spaces').insert({
    kind,
    name: name.trim(),
    created_by: me,
    location: location.trim() || null,
    lat: geo?.lat ?? null,
    lng: geo?.lng ?? null,
  }).select('id').single();
  if (error) throw error;
  return (data as { id: string }).id;
}
