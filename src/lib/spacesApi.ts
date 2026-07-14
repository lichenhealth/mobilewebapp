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
  parent: { id: string; name: string } | null;   // a group's home community/org
}

export async function loadSpaceProfile(id: string): Promise<SpaceProfileRow | null> {
  const { data, error } = await supabase
    .from('spaces')
    .select('id, kind, name, handle, description, avatar_url, location, lat, lng, created_by, parent:spaces!spaces_parent_space_id_fkey(id, name)')
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
  parent_space_id?: string | null;   // group admins nest/unnest under a community/org
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

/** Create a space with its location in one go (creator becomes super_admin
 *  via the handle_new_space trigger). parentId nests a group under a
 *  community/organization. Returns the new space id. */
export async function createSpaceWithLocation(
  me: string, name: string, kind: SpaceKind, location: string, geo: GeoPoint | null,
  parentId?: string | null,
): Promise<string> {
  const { data, error } = await supabase.from('spaces').insert({
    kind,
    name: name.trim(),
    created_by: me,
    location: location.trim() || null,
    lat: geo?.lat ?? null,
    lng: geo?.lng ?? null,
    parent_space_id: parentId ?? null,
  }).select('id').single();
  if (error) throw error;
  return (data as { id: string }).id;
}

// ─── Directory (real Communities/Groups/Organizations/Places screens) ─────────

export interface SpaceDirectoryRow {
  id: string;
  name: string;
  kind: SpaceKind;
  description: string | null;
  avatar_url: string | null;
  location: string | null;
  parent: { id: string; name: string } | null;
  member_count: number;
}

/** Every space of a kind, with member counts and (for groups) the parent. */
export async function listSpacesByKind(kind: SpaceKind): Promise<SpaceDirectoryRow[]> {
  const { data, error } = await supabase
    .from('spaces')
    .select('id, name, kind, description, avatar_url, location, parent:spaces!spaces_parent_space_id_fkey(id, name), space_members(count)')
    .eq('kind', kind)
    .order('name');
  if (error) { console.warn('listSpacesByKind:', error.message); return []; }
  type Raw = Omit<SpaceDirectoryRow, 'parent' | 'member_count'> & {
    parent: { id: string; name: string } | null;
    space_members: { count: number }[];
  };
  return (((data as unknown as Raw[] | null) ?? []).map((r) => ({
    ...r, member_count: r.space_members?.[0]?.count ?? 0,
  })));
}

/** Groups nested under a community/organization. */
export async function listChildGroups(parentId: string): Promise<SpaceDirectoryRow[]> {
  const { data, error } = await supabase
    .from('spaces')
    .select('id, name, kind, description, avatar_url, location, space_members(count)')
    .eq('parent_space_id', parentId)
    .order('name');
  if (error) { console.warn('listChildGroups:', error.message); return []; }
  type Raw = Omit<SpaceDirectoryRow, 'parent' | 'member_count'> & { space_members: { count: number }[] };
  return (((data as unknown as Raw[] | null) ?? []).map((r) => ({
    ...r, parent: null, member_count: r.space_members?.[0]?.count ?? 0,
  })));
}

/** All spaces I'm a member of, for the side menu's per-kind sub-lists. */
export async function listMyMemberSpaces(me: string): Promise<MappableSpace[]> {
  const { data, error } = await supabase
    .from('space_members')
    .select('spaces(id, name, kind, location, lat, lng)')
    .eq('profile_id', me);
  if (error) { console.warn('listMyMemberSpaces:', error.message); return []; }
  return (((data as unknown as { spaces: MappableSpace | null }[] | null) ?? [])
    .map((r) => r.spaces)
    .filter((s): s is MappableSpace => !!s))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ─── Membership: request + approval, or admin invite (care-team pattern) ──────
// One pending row per (space, person). initiated_by = the person → a JOIN
// REQUEST admins approve; initiated_by = an admin → an INVITE the person
// accepts. Approval/acceptance go through SECURITY DEFINER RPCs; the
// sync_member_to_chat trigger adds the new member to the space chat.

export type MyRequestState = 'requested' | 'invited' | null;

export async function loadMyRequestFor(spaceId: string, me: string): Promise<MyRequestState> {
  const { data, error } = await supabase
    .from('space_membership_requests')
    .select('initiated_by')
    .eq('space_id', spaceId).eq('profile_id', me)
    .maybeSingle();
  if (error) { console.warn('loadMyRequestFor:', error.message); return null; }
  if (!data) return null;
  return (data as { initiated_by: string }).initiated_by === me ? 'requested' : 'invited';
}

export async function requestToJoin(spaceId: string, me: string): Promise<void> {
  const { error } = await supabase.from('space_membership_requests')
    .insert({ space_id: spaceId, profile_id: me, initiated_by: me });
  if (error && error.code !== '23505') throw error;
}

/** Cancel my request, decline my invite, or (as admin) decline/withdraw. */
export async function removeRequest(spaceId: string, profileId: string): Promise<void> {
  const { error } = await supabase.from('space_membership_requests')
    .delete().eq('space_id', spaceId).eq('profile_id', profileId);
  if (error) throw error;
}

export interface PendingRequestRow {
  profile_id: string;
  initiated_by: string;
  created_at: string;
  profile: { full_name: string | null; avatar_url: string | null } | null;
}

/** Admin view: everything pending on a space (requests AND outstanding invites). */
export async function listPendingRequests(spaceId: string): Promise<PendingRequestRow[]> {
  const { data, error } = await supabase
    .from('space_membership_requests')
    .select('profile_id, initiated_by, created_at, profile:profiles!space_membership_requests_profile_id_fkey(full_name, avatar_url)')
    .eq('space_id', spaceId)
    .order('created_at');
  if (error) { console.warn('listPendingRequests:', error.message); return []; }
  return ((data as unknown as PendingRequestRow[] | null) ?? []);
}

export async function inviteMember(spaceId: string, me: string, profileId: string): Promise<void> {
  const { error } = await supabase.from('space_membership_requests')
    .insert({ space_id: spaceId, profile_id: profileId, initiated_by: me });
  if (error && error.code !== '23505') throw error;
}

export async function approveJoin(spaceId: string, profileId: string): Promise<void> {
  const { error } = await supabase.rpc('approve_join_request', { p_space: spaceId, p_profile: profileId });
  if (error) throw error;
}

export async function acceptInvite(spaceId: string): Promise<void> {
  const { error } = await supabase.rpc('accept_space_invite', { p_space: spaceId });
  if (error) throw error;
}

/** Leave a space (existing self-delete RLS; the chat sync trigger removes
 *  chat membership too). Super admins can't leave — they run the place. */
export async function leaveSpace(spaceId: string, me: string): Promise<void> {
  const { error } = await supabase.from('space_members')
    .delete().eq('space_id', spaceId).eq('profile_id', me);
  if (error) throw error;
}
