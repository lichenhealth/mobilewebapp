import { supabase } from './supabase';

/** AN IDENTITY IS A SCOPE LIKE A SPACE IS (founder 2026-08-21: the doors on
 *  an identity's page open the REAL sections, filtered — "marketplace with
 *  the filter of first responder identity already added"). The URL carries
 *  `?identity=<categoryId>`, same grammar as `?space=`/`?member=`; this
 *  resolves it to the names every scoped surface renders. */
export interface IdentityScope { id: string; name: string; plural: string }

/** "Veteran" → "Veterans", "Military Family" → "Military Families". */
export const pluralIdentity = (name: string): string =>
  /[^aeiou]y$/i.test(name) ? name.replace(/y$/i, 'ies')
  : /s$/i.test(name) ? name : name + 's';

export async function resolveIdentityScope(catId: string | null): Promise<IdentityScope | null> {
  if (!catId) return null;
  const { data } = await supabase.from('categories').select('id, name')
    .eq('id', catId).eq('domain', 'identity').maybeSingle();
  const row = data as { id: string; name: string } | null;
  return row ? { ...row, plural: pluralIdentity(row.name) } : null;
}
