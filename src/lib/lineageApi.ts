// WISDOM LINEAGES (founder 2026-11-20: "just like huachuma gets current-cy,
// the mexica should get value attribution in some way"). A lineage is a
// stewarded member of kind 'lineage'. Until its own recognized holders step
// in, Lichen holds its value in trust (the Lichen organization stewards it).
// Platform stewards create lineages; members NOMINATE a lineage or a holder,
// and a nominated holder must accept before stewardship moves.
import { supabase } from './supabase';

export type Lineage = { id: string; full_name: string };
export type RootedIn = { id: string; name: string };

export type LineageNomination = {
  id: string;
  kind: 'lineage' | 'holder';
  lineage_id: string | null;
  name: string | null;
  description: string | null;
  nominee_profile_id: string | null;
  note: string | null;
  nominated_by: string;
  status: 'pending' | 'approved' | 'declined' | 'accepted' | 'withdrawn';
  created_at: string;
  nominee?: { full_name: string | null } | null;
  nominator?: { full_name: string | null } | null;
  lineage?: { full_name: string | null } | null;
};

export async function listLineages(): Promise<Lineage[]> {
  const { data } = await supabase.from('profiles').select('id, full_name')
    .eq('kind', 'lineage').order('full_name').limit(500);
  return (data as Lineage[] | null) ?? [];
}

/** A post's declared lineages, sanitized off details. */
export function readRootedIn(details: unknown): RootedIn[] {
  const raw = (details as { rootedIn?: unknown } | null)?.rootedIn;
  if (!Array.isArray(raw)) return [];
  return raw.filter((r): r is RootedIn =>
    !!r && typeof (r as RootedIn).id === 'string' && typeof (r as RootedIn).name === 'string');
}

export async function nominateLineage(name: string, description: string, note: string): Promise<void> {
  const { error } = await supabase.from('lineage_nominations').insert({
    kind: 'lineage', name: name.trim(), description: description.trim() || null, note: note.trim() || null,
  });
  if (error) throw new Error(error.message);
}

export async function nominateHolder(lineageId: string, nomineeId: string, note: string): Promise<void> {
  const { error } = await supabase.from('lineage_nominations').insert({
    kind: 'holder', lineage_id: lineageId, nominee_profile_id: nomineeId, note: note.trim() || null,
  });
  if (error) throw new Error(error.message);
}

const NOM_COLS = 'id, kind, lineage_id, name, description, nominee_profile_id, note, nominated_by, status, created_at, ' +
  'nominee:profiles!lineage_nominations_nominee_profile_id_fkey(full_name), ' +
  'nominator:profiles!lineage_nominations_nominated_by_fkey(full_name), ' +
  'lineage:profiles!lineage_nominations_lineage_id_fkey(full_name)';

/** Platform stewards: every nomination waiting for a decision. */
export async function listPendingNominations(): Promise<LineageNomination[]> {
  const { data } = await supabase.from('lineage_nominations').select(NOM_COLS)
    .eq('status', 'pending').order('created_at');
  return (data as unknown as LineageNomination[] | null) ?? [];
}

/** An approved holder invitation waiting for ME, on this lineage. */
export async function myHolderInvite(lineageId: string, me: string): Promise<LineageNomination | null> {
  if (!me) return null;
  const { data } = await supabase.from('lineage_nominations').select('id, kind, lineage_id, status, created_at')
    .eq('lineage_id', lineageId).eq('nominee_profile_id', me).eq('status', 'approved').limit(1);
  return ((data as unknown as LineageNomination[] | null) ?? [])[0] ?? null;
}

export async function approveNomination(id: string, name?: string, description?: string): Promise<void> {
  const { error } = await supabase.rpc('approve_lineage_nomination', {
    p_id: id, p_name: name?.trim() || null, p_description: description?.trim() || null,
  });
  if (error) throw new Error(error.message);
}

export async function declineNomination(id: string): Promise<void> {
  const { error } = await supabase.rpc('decline_lineage_nomination', { p_id: id });
  if (error) throw new Error(error.message);
}

export async function answerStewardship(id: string, accept: boolean): Promise<void> {
  const { error } = await supabase.rpc('answer_lineage_stewardship', { p_id: id, p_accept: accept });
  if (error) throw new Error(error.message);
}

/** Offerings that name this lineage as their root. */
export async function loadRootedOfferings(lineageId: string): Promise<{ id: string; title: string | null; body: string | null }[]> {
  const { data } = await supabase.from('posts').select('id, title, body')
    .contains('details', { rootedIn: [{ id: lineageId }] })
    .order('created_at', { ascending: false }).limit(20);
  return (data as { id: string; title: string | null; body: string | null }[] | null) ?? [];
}

/** Members a holder can be chosen from (findable people). */
export async function searchPeople(q: string): Promise<{ id: string; full_name: string }[]> {
  const t = q.trim();
  if (t.length < 2) return [];
  const { data } = await supabase.from('profiles').select('id, full_name')
    .eq('kind', 'person').eq('findable', true).ilike('full_name', `%${t}%`).limit(6);
  return (data as { id: string; full_name: string }[] | null) ?? [];
}
