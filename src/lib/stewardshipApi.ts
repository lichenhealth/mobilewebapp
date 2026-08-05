import { supabase } from './supabase';

/** Beyond-human members (founder 2026-08-05). A being — a therapy horse, a
 *  sacred cactus, a river — is a real profile row with no login, tended by a
 *  person or by a space. Because it IS a profile, it inherits the whole actor
 *  surface for free: it can hold Current-cy, be woven and trusted, own a
 *  calendar, be booked, be recommended.
 *
 *  ASPECT is individual-vs-collective, NOT plant-vs-animal (settled
 *  2026-07-18): Tango is an individual animal; Huachuma is a collective
 *  spirit. Both kinds can be either. */

export type EntityKind = 'plant' | 'animal' | 'place' | 'element' | 'collective';
export type EntityAspect = 'individual' | 'collective';

export const ENTITY_KINDS: { value: EntityKind; label: string }[] = [
  { value: 'animal', label: 'Animal' },
  { value: 'plant', label: 'Plant' },
  { value: 'place', label: 'Place' },
  { value: 'element', label: 'Element' },
  { value: 'collective', label: 'Collective' },
];

export interface Being {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  headline: string | null;
  kind: string;
  aspect: string | null;
  steward_profile_id: string | null;
  steward_space_id: string | null;
}

const BEING_COLS = 'id, full_name, avatar_url, headline, kind, aspect, steward_profile_id, steward_space_id';

/** Beings I tend — directly, or through a space I administer. Returns [] on
 *  any error so screens keep working before the migration lands. */
export async function listMyBeings(me: string): Promise<Being[]> {
  if (!me) return [];
  const mine = await supabase.from('profiles').select(BEING_COLS)
    .eq('steward_profile_id', me);
  if (mine.error) return [];   // pre-migration: the columns aren't there yet

  const { data: admined } = await supabase.from('space_members')
    .select('space_id').eq('profile_id', me).in('role', ['admin', 'super_admin']);
  const spaceIds = ((admined as { space_id: string }[] | null) ?? []).map((r) => r.space_id);

  let viaSpaces: Being[] = [];
  if (spaceIds.length) {
    const { data } = await supabase.from('profiles').select(BEING_COLS)
      .in('steward_space_id', spaceIds);
    viaSpaces = (data as Being[] | null) ?? [];
  }
  const all = [...((mine.data as Being[] | null) ?? []), ...viaSpaces];
  // A being can only have one steward, so ids can't collide — but be safe.
  const seen = new Set<string>();
  return all.filter((b) => !seen.has(b.id) && seen.add(b.id));
}

/** Bring a being into the web. Steward is YOU unless a space is named, in
 *  which case you must administer it (the RPC re-checks server-side). */
export async function createBeing(
  name: string, kind: EntityKind, aspect: EntityAspect, stewardSpaceId?: string,
): Promise<{ ok: boolean; id?: string; message: string }> {
  const { data, error } = await supabase.rpc('create_entity_profile', {
    p_name: name, p_kind: kind, p_aspect: aspect,
    p_steward_space: stewardSpaceId ?? null,
  });
  if (error) return { ok: false, message: error.message };
  return { ok: true, id: data as string, message: `${name} is woven in.` };
}

/** Who tends this being — for the "Stewarded by" line on its profile. */
export async function loadSteward(
  b: { steward_profile_id?: string | null; steward_space_id?: string | null },
): Promise<{ name: string; to: string } | null> {
  if (b.steward_profile_id) {
    const { data } = await supabase.from('profiles')
      .select('full_name').eq('id', b.steward_profile_id).maybeSingle();
    const name = (data as { full_name: string | null } | null)?.full_name;
    return name ? { name, to: `/members/${b.steward_profile_id}` } : null;
  }
  if (b.steward_space_id) {
    const { data } = await supabase.from('spaces')
      .select('name').eq('id', b.steward_space_id).maybeSingle();
    const name = (data as { name: string } | null)?.name;
    return name ? { name, to: `/spaces/${b.steward_space_id}` } : null;
  }
  return null;
}
