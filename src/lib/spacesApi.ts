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
  // NOTE: no self-join embed here — spaces!parent_space_id resolves to the
  // CHILDREN direction (an array), not the parent. Fetch the parent by id.
  const { data, error } = await supabase
    .from('spaces')
    .select('id, kind, name, handle, description, avatar_url, location, lat, lng, created_by, parent_space_id')
    .eq('id', id)
    .maybeSingle();
  if (error) { console.warn('loadSpaceProfile:', error.message); return null; }
  if (!data) return null;
  const row = data as Omit<SpaceProfileRow, 'parent'> & { parent_space_id: string | null };
  let parent: { id: string; name: string } | null = null;
  if (row.parent_space_id) {
    const { data: p } = await supabase.from('spaces')
      .select('id, name').eq('id', row.parent_space_id).maybeSingle();
    parent = (p as { id: string; name: string } | null) ?? null;
  }
  return { ...row, parent };
}

export type SpaceRole = 'super_admin' | 'admin' | 'member';
export interface SpaceMemberRow {
  profile_id: string;
  role: SpaceRole;
  /** Scoped stewardship (founder 2026-07-24): null = a full admin (everything);
   *  a subset = exactly what this admin tends. Meaningless for members. */
  duties: string[] | null;
  profile: { full_name: string | null; avatar_url: string | null } | null;
}

/** The named duties a super admin can scope an admin to. Only duties with
 *  real teeth are listed — events/chat join when those powers exist. */
export const SPACE_DUTIES: { key: string; label: string; hint: string }[] = [
  { key: 'library', label: 'Library', hint: 'organize the collections' },
  { key: 'courses', label: 'Courses', hint: 'co-teach: lessons & details' },
  { key: 'members', label: 'Members', hint: 'approve, invite, endorse' },
];

/** Does this role+duties combination steward the given duty? */
export function holdsDuty(
  role: SpaceRole | undefined, duties: string[] | null | undefined, duty: string,
): boolean {
  if (role === 'super_admin') return true;
  if (role !== 'admin') return false;
  return !duties || duties.includes(duty);
}

const ROLE_ORDER: Record<SpaceRole, number> = { super_admin: 0, admin: 1, member: 2 };

export async function loadSpaceMembers(id: string): Promise<SpaceMemberRow[]> {
  let { data, error } = (await supabase
    .from('space_members')
    .select('profile_id, role, duties, profile:profiles(full_name, avatar_url)')
    .eq('space_id', id)) as { data: unknown; error: { message: string } | null };
  if (error) {
    // pre-migration (no duties column yet): fall back so the list never blanks
    ({ data, error } = (await supabase
      .from('space_members')
      .select('profile_id, role, profile:profiles(full_name, avatar_url)')
      .eq('space_id', id)) as { data: unknown; error: { message: string } | null });
  }
  if (error) { console.warn('loadSpaceMembers:', error.message); return []; }
  return (((data as unknown as SpaceMemberRow[] | null) ?? []))
    .map((m) => ({ ...m, duties: m.duties ?? null }))
    .sort((a, b) =>
      ROLE_ORDER[a.role] - ROLE_ORDER[b.role]
      || (a.profile?.full_name ?? '').localeCompare(b.profile?.full_name ?? ''));
}

/** My role + duties in a space (null = not a member). Pre-migration safe. */
export async function myDutiesIn(spaceId: string): Promise<{ role: SpaceRole; duties: string[] | null } | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from('space_members').select('role, duties')
    .eq('space_id', spaceId).eq('profile_id', user.id).maybeSingle();
  if (!error) return (data as { role: SpaceRole; duties: string[] | null } | null) ?? null;
  const { data: legacy } = await supabase
    .from('space_members').select('role')
    .eq('space_id', spaceId).eq('profile_id', user.id).maybeSingle();
  return legacy ? { role: (legacy as { role: SpaceRole }).role, duties: null } : null;
}

/** Super admin grants/edits/revokes admin — duties null = stewards everything. */
export async function setMemberRole(
  spaceId: string, profileId: string, role: 'admin' | 'member', duties: string[] | null,
): Promise<void> {
  const { error } = await supabase.rpc('set_member_role', {
    p_space: spaceId, p_profile: profileId, p_role: role, p_duties: duties,
  });
  if (error) throw error;
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
    .select('id, name, kind, description, avatar_url, location, parent_space_id, space_members(count)')
    .eq('kind', kind)
    .order('name');
  if (error) { console.warn('listSpacesByKind:', error.message); return []; }
  type Raw = Omit<SpaceDirectoryRow, 'parent' | 'member_count'> & {
    parent_space_id: string | null;
    space_members: { count: number }[];
  };
  const rows = ((data as unknown as Raw[] | null) ?? []);
  // Parent names in one shot (self-join embeds resolve the wrong way — see above).
  const parentIds = [...new Set(rows.map((r) => r.parent_space_id).filter((x): x is string => !!x))];
  const names = new Map<string, string>();
  if (parentIds.length) {
    const { data: ps } = await supabase.from('spaces').select('id, name').in('id', parentIds);
    for (const p of (ps as { id: string; name: string }[] | null) ?? []) names.set(p.id, p.name);
  }
  return rows.map((r) => ({
    ...r,
    parent: r.parent_space_id ? { id: r.parent_space_id, name: names.get(r.parent_space_id) ?? 'a community' } : null,
    member_count: r.space_members?.[0]?.count ?? 0,
  }));
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
  const initiator = (data as { initiated_by: string }).initiated_by;
  if (initiator === me) return 'requested';
  // Only a members-duty holder's row is a real INVITE. Anything else is a
  // member SUGGESTION — invisible to the suggested person until endorsed
  // (PR #58 doctrine: the suggested person hears nothing).
  const { data: init } = await supabase
    .from('space_members').select('role, duties')
    .eq('space_id', spaceId).eq('profile_id', initiator).maybeSingle();
  const i = init as { role: SpaceRole; duties: string[] | null } | null;
  return i && holdsDuty(i.role, i.duties ?? null, 'members') ? 'invited' : null;
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
  initiator: { full_name: string | null } | null;
}

/** Admin view: everything pending on a space (requests AND outstanding invites). */
export async function listPendingRequests(spaceId: string): Promise<PendingRequestRow[]> {
  const { data, error } = await supabase
    .from('space_membership_requests')
    .select('profile_id, initiated_by, created_at, profile:profiles!space_membership_requests_profile_id_fkey(full_name, avatar_url), initiator:profiles!space_membership_requests_initiated_by_fkey(full_name)')
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

/** A plain member suggests someone — same row shape; admins must endorse it
 *  into a real invite before the person hears anything. */
export const suggestMember = inviteMember;

/** Admin endorses a member's suggestion → it becomes the admin's invite. */
export async function endorseSuggestion(spaceId: string, profileId: string): Promise<void> {
  const { error } = await supabase.rpc('endorse_member_suggestion', { p_space: spaceId, p_profile: profileId });
  if (error) throw error;
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

// ─── Group nesting proposals (consensual: parent admins approve) ──────────────

export interface NestingRequestRow {
  group_id: string;
  parent_id: string;
  initiated_by: string;
  group: { name: string; avatar_url: string | null } | null;
  parent: { name: string } | null;
  proposer: { full_name: string | null } | null;
}

/** Is this member an admin/super_admin of the space? */
export async function amIAdminOf(spaceId: string, me: string): Promise<boolean> {
  const { data } = await supabase.from('space_members')
    .select('role').eq('space_id', spaceId).eq('profile_id', me).maybeSingle();
  const role = (data as { role: string } | null)?.role;
  return role === 'admin' || role === 'super_admin';
}

export async function proposeNesting(groupId: string, parentId: string, me: string): Promise<void> {
  const { error } = await supabase.from('space_nesting_requests')
    .insert({ group_id: groupId, parent_id: parentId, initiated_by: me });
  if (error && error.code !== '23505') throw error;
}

/** A group's own pending proposal (visible to its admins). */
export async function loadNestingFor(groupId: string): Promise<{ parent_id: string; parentName: string } | null> {
  const { data, error } = await supabase.from('space_nesting_requests')
    .select('parent_id, parent:spaces!space_nesting_requests_parent_id_fkey(name)')
    .eq('group_id', groupId).maybeSingle();
  if (error || !data) return null;
  const row = data as unknown as { parent_id: string; parent: { name: string } | null };
  return { parent_id: row.parent_id, parentName: row.parent?.name ?? 'a community' };
}

/** Groups knocking on this community/organization's door (admin view). */
export async function listNestingProposals(parentId: string): Promise<NestingRequestRow[]> {
  const { data, error } = await supabase.from('space_nesting_requests')
    .select('group_id, parent_id, initiated_by, group:spaces!space_nesting_requests_group_id_fkey(name, avatar_url), proposer:profiles!space_nesting_requests_initiated_by_fkey(full_name)')
    .eq('parent_id', parentId)
    .order('created_at');
  if (error) { console.warn('listNestingProposals:', error.message); return []; }
  return ((data as unknown as NestingRequestRow[] | null) ?? []);
}

export async function approveNesting(groupId: string): Promise<void> {
  const { error } = await supabase.rpc('approve_group_nesting', { p_group: groupId });
  if (error) throw error;
}

/** Withdraw (group side) or decline (parent side). */
export async function removeNesting(groupId: string): Promise<void> {
  const { error } = await supabase.from('space_nesting_requests').delete().eq('group_id', groupId);
  if (error) throw error;
}

/** Parent-side un-nest: the community's admins release a nested group back
 *  to standalone (its members, chat, and posts are untouched). */
export async function ejectGroup(groupId: string): Promise<void> {
  const { error } = await supabase.rpc('eject_group', { p_group: groupId });
  if (error) throw error;
}

// ── Curated-section shares (founder 2026-07-26): a space's Courses/Library
//    show only space-authored posts + duty-holder-APPROVED member shares. ─────

export type SectionArea = 'courses' | 'library';
export interface SectionShareRow {
  space_id: string;
  post_id: string;
  area: SectionArea;
  status: 'pending' | 'approved' | 'declined';
  requested_by: string;
  requester: { full_name: string | null } | null;
}

/** Approved post ids for a space's curated section. `ok:false` = the
 *  migration hasn't run — callers keep today's unfiltered behavior. */
export async function listApprovedSectionShares(
  spaceId: string, area: SectionArea,
): Promise<{ ok: boolean; ids: Set<string> }> {
  const { data, error } = await supabase
    .from('space_section_shares')
    .select('post_id')
    .eq('space_id', spaceId).eq('area', area).eq('status', 'approved');
  if (error) return { ok: false, ids: new Set() };
  return { ok: true, ids: new Set(((data as { post_id: string }[] | null) ?? []).map((r) => r.post_id)) };
}

/** Pending shares awaiting this space's stewards. */
export async function listPendingSectionShares(spaceId: string): Promise<SectionShareRow[]> {
  const { data, error } = await supabase
    .from('space_section_shares')
    .select('space_id, post_id, area, status, requested_by, requester:profiles!space_section_shares_requested_by_fkey(full_name)')
    .eq('space_id', spaceId).eq('status', 'pending')
    .order('created_at');
  if (error) { console.warn('listPendingSectionShares:', error.message); return []; }
  return ((data as unknown as SectionShareRow[] | null) ?? []);
}

export async function decideSectionShare(
  spaceId: string, postId: string, area: SectionArea, approve: boolean,
): Promise<void> {
  const { error } = await supabase.rpc('decide_section_share', {
    p_space: spaceId, p_post: postId, p_area: area, p_approve: approve,
  });
  if (error) throw error;
}

// ─── The steward's ledger: what's waiting across every space you admin ──────
// Batched (4 queries total, not per-space) so the side menu can wear blue
// admin badges without hammering the API. Duty-scoped: a Library-only admin
// only counts library shares; membership requests need the 'members' duty.
export interface AdminDesk { ids: Set<string>; counts: Record<string, number> }
export async function listMyAdminDeskCounts(me: string): Promise<AdminDesk> {
  const { data: mine } = await supabase.from('space_members')
    .select('space_id, role, duties')
    .eq('profile_id', me).in('role', ['admin', 'super_admin']);
  const rows = (mine as { space_id: string; role: string; duties: string[] | null }[] | null) ?? [];
  const ids = rows.map((r) => r.space_id);
  const desk: AdminDesk = { ids: new Set(ids), counts: {} };
  if (!ids.length) return desk;
  const dutyOf = new Map(rows.map((r) => [r.space_id, { role: r.role, duties: r.duties }]));
  const has = (sid: string, duty: string) => {
    const d = dutyOf.get(sid);
    return !!d && holdsDuty(d.role as SpaceRole, d.duties, duty);
  };
  const bump = (sid: string) => { desk.counts[sid] = (desk.counts[sid] ?? 0) + 1; };
  const [shares, reqs, nests] = await Promise.all([
    supabase.from('space_section_shares').select('space_id, area')
      .eq('status', 'pending').in('space_id', ids),
    supabase.from('space_membership_requests').select('space_id, profile_id, initiated_by')
      .in('space_id', ids),
    supabase.from('space_nesting_requests').select('parent_id')
      .in('parent_id', ids),
  ]);
  for (const r of (shares.data as { space_id: string; area: string }[] | null) ?? []) {
    if (has(r.space_id, r.area === 'courses' ? 'courses' : 'library')) bump(r.space_id);
  }
  // Classify: self-initiated = join request (actionable); initiated by an
  // admin = an INVITE awaiting the invitee (not our move — no badge);
  // initiated by a plain member = a suggestion (actionable).
  const reqRows = (reqs.data as { space_id: string; profile_id: string; initiated_by: string }[] | null) ?? [];
  const initiators = [...new Set(reqRows.filter((r) => r.initiated_by !== r.profile_id).map((r) => r.initiated_by))];
  const adminInit = new Set<string>();
  if (initiators.length) {
    const { data: irows } = await supabase.from('space_members')
      .select('space_id, profile_id').in('space_id', ids)
      .in('profile_id', initiators).in('role', ['admin', 'super_admin']);
    for (const r of (irows as { space_id: string; profile_id: string }[] | null) ?? []) {
      adminInit.add(`${r.space_id}:${r.profile_id}`);
    }
  }
  for (const r of reqRows) {
    const isInvite = r.initiated_by !== r.profile_id && adminInit.has(`${r.space_id}:${r.initiated_by}`);
    if (!isInvite && has(r.space_id, 'members')) bump(r.space_id);
  }
  for (const r of (nests.data as { parent_id: string }[] | null) ?? []) bump(r.parent_id);
  return desk;
}
