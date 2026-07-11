import { supabase } from './supabase';
import type { GeoPoint } from './geoApi';

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

/** Pinnable spaces: place/organization with coordinates. */
export async function loadMappableSpaces(): Promise<MappableSpace[]> {
  const { data, error } = await supabase
    .from('spaces')
    .select('id, name, kind, location, lat, lng')
    .in('kind', ['place', 'organization'])
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
