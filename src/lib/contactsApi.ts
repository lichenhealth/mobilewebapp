import { supabase } from './supabase';
import type { IconName } from '../components/Icon';

// CONTACT CARDS (founder 2026-11-15) — a member's own private cards: people
// (personal, professional, or both), organizations (which can run places),
// communities, groups and places. GRAY until they're on Lichen, PEACH once a
// card links to their real profile or page (the database links them when they
// join, and on save when they're already here). Guest lists group cards; the
// database keeps the two in step.

export type ContactKind = 'person' | 'organization' | 'community' | 'group' | 'place';
export const CONTACT_KINDS: { id: ContactKind; label: string; plural: string; icon: IconName }[] = [
  { id: 'person', label: 'Person', plural: 'People', icon: 'profile' },
  { id: 'organization', label: 'Organization', plural: 'Organizations', icon: 'building' },
  { id: 'place', label: 'Place', plural: 'Places', icon: 'location' },
  { id: 'community', label: 'Community', plural: 'Communities', icon: 'user-multiple' },
  { id: 'group', label: 'Group', plural: 'Groups', icon: 'groups' },
];
export const kindMeta = (k: ContactKind) => CONTACT_KINDS.find((x) => x.id === k) ?? CONTACT_KINDS[0];

export type Contact = {
  id: string;
  owner_id: string;
  kind: ContactKind;
  name: string;
  roles: ('personal' | 'professional')[];
  parent_id: string | null;
  photo_url: string | null;
  emails: string[];
  phones: string[];
  website: string | null;
  socials: Record<string, string>;
  address: string | null;
  notes: string | null;
  source: string | null;
  linked_profile_id: string | null;
  linked_space_id: string | null;
  linked_at: string | null;
  updated_at: string;
};
export type ContactDraft = Partial<Omit<Contact, 'id' | 'owner_id' | 'updated_at'>>;

const COLS = 'id, owner_id, kind, name, roles, parent_id, photo_url, emails, phones, website, socials, address, notes, source, linked_profile_id, linked_space_id, linked_at, updated_at';

export const onLichen = (c: Pick<Contact, 'linked_profile_id' | 'linked_space_id'>) => !!(c.linked_profile_id || c.linked_space_id);

export async function listContacts(ownerId: string): Promise<Contact[]> {
  const { data } = await supabase.from('contacts').select(COLS).eq('owner_id', ownerId).order('name');
  return (data as Contact[] | null) ?? [];
}

export async function createContact(ownerId: string, d: ContactDraft): Promise<Contact> {
  const { data, error } = await supabase.from('contacts').insert({ ...d, owner_id: ownerId }).select(COLS).single();
  if (error) throw new Error(error.message);
  return data as Contact;
}

export async function updateContact(id: string, d: ContactDraft): Promise<Contact> {
  const { data, error } = await supabase.from('contacts').update(d).eq('id', id).select(COLS).single();
  if (error) throw new Error(error.message);
  return data as Contact;
}

export async function deleteContact(id: string) {
  const { error } = await supabase.from('contacts').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

/** Where a peach card leads: their profile or their page. */
export function contactPath(c: Contact): string | null {
  if (c.linked_profile_id) return `/members/${c.linked_profile_id}`;
  if (c.linked_space_id) return `/spaces/${c.linked_space_id}`;
  return null;
}

/** "a@x.org, b@y.org\n555…" → clean list. */
export function splitList(s: string): string[] {
  return s.split(/[,;\n]+/).map((x) => x.trim()).filter(Boolean);
}

// ── SHARING A LIST ────────────────────────────────────────────────────────
// The ladder every Lichen share uses: a person rule beats a circle rule beats
// the web beats everyone; at the same rung the most restrictive wins.
export type ShareAudience = 'everyone' | 'mycelium' | 'space' | 'profile';
export type ShareLevel = 'hidden' | 'see' | 'edit';
export type ListShare = {
  id: string;
  list_id: string;
  audience_type: ShareAudience;
  audience_space_id: string | null;
  audience_profile_id: string | null;
  level: ShareLevel;
};

export async function listShares(listId: string): Promise<ListShare[]> {
  const { data } = await supabase.from('contact_list_shares')
    .select('id, list_id, audience_type, audience_space_id, audience_profile_id, level').eq('list_id', listId);
  return (data as ListShare[] | null) ?? [];
}

export async function addShare(ownerId: string, listId: string, s: { audience_type: ShareAudience; audience_space_id?: string | null; audience_profile_id?: string | null; level: ShareLevel }) {
  const { error } = await supabase.from('contact_list_shares').insert({
    owner_id: ownerId, list_id: listId, audience_type: s.audience_type,
    audience_space_id: s.audience_space_id ?? null, audience_profile_id: s.audience_profile_id ?? null, level: s.level,
  });
  if (error) throw new Error(error.code === '23505' ? 'That audience already has a rule — change it below.' : error.message);
}

export async function setShareLevel(id: string, level: ShareLevel) {
  const { error } = await supabase.from('contact_list_shares').update({ level }).eq('id', id);
  if (error) throw new Error(error.message);
}

export async function removeShare(id: string) {
  const { error } = await supabase.from('contact_list_shares').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

export type SharedList = {
  id: string; name: string; owner_id: string; owner_name: string;
  entries: import('./guestListsApi').ListEntry[]; space_ids: string[]; level: ShareLevel;
};

/** Lists other members share with me (RLS returns only those the ladder admits). */
export async function listSharedWithMe(me: string): Promise<SharedList[]> {
  const { data } = await supabase.from('guest_lists')
    .select('id, name, owner_id, entries, space_ids, owner:profiles!guest_lists_owner_id_fkey(full_name)')
    .neq('owner_id', me).order('updated_at', { ascending: false });
  const rows = (data as unknown as (Omit<SharedList, 'owner_name' | 'level'> & { owner: { full_name: string } | null })[] | null) ?? [];
  const out: SharedList[] = [];
  for (const r of rows) {
    const { data: lvl } = await supabase.rpc('contact_list_level', { p_list: r.id, p_viewer: me });
    out.push({ ...r, owner_name: r.owner?.full_name ?? 'A member', level: (lvl as ShareLevel) ?? 'see' });
  }
  return out;
}
