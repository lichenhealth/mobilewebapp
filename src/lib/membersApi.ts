import { supabase } from './supabase';

// ─── Public member profiles (/members/:id) ────────────────────────────────────
// Only the column-granted safe fields (email/phone stay locked; see the
// privacy migrations). Providers surface through their category offerings.

export interface MemberProfile {
  id: string;
  full_name: string | null;
  headline: string | null;
  bio: string | null;
  avatar_url: string | null;
  location: string | null;
  /** This member works without the assistant (founder 2026-08-05) — their
   *  AI door reads slashed. Absent pre-migration = on. */
  assistant_enabled?: boolean;
  /** Beyond-human members (founder 2026-08-05): 'person' unless this is a
   *  being tended by someone. Absent pre-migration = treat as a person. */
  kind?: string;
  aspect?: string | null;
  steward_profile_id?: string | null;
  steward_space_id?: string | null;
}

export async function loadMemberProfile(id: string): Promise<MemberProfile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, headline, bio, avatar_url, location, assistant_enabled, kind, aspect, steward_profile_id, steward_space_id')
    .eq('id', id)
    .maybeSingle();
  if (error) { console.warn('loadMemberProfile:', error.message); return null; }
  return (data as MemberProfile | null) ?? null;
}

export interface MemberOfferings { services: string[]; goods: string[] }

/** Category names a member offers, split by domain (the Provider face). */
export async function loadMemberOfferings(id: string): Promise<MemberOfferings> {
  const { data, error } = await supabase
    .from('profile_categories')
    .select('categories(name, domain)')
    .eq('profile_id', id);
  if (error) { console.warn('loadMemberOfferings:', error.message); return { services: [], goods: [] }; }
  const rows = (data as unknown as { categories: { name: string; domain: 'good' | 'service' | 'place' } | null }[] | null) ?? [];
  const services: string[] = [];
  const goods: string[] = [];
  for (const r of rows) {
    if (!r.categories) continue;
    (r.categories.domain === 'service' ? services : goods).push(r.categories.name);
  }
  services.sort(); goods.sort();
  return { services, goods };
}
