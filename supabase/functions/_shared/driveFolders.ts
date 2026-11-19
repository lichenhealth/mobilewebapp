// ONE WAY TO NAME A FOLDER (founder 2026-11-19: "the brain can't import
// lisa's farm photos and rename it Lichen Kickoff and drop it in the photos
// folder"). Folders nest, so a name alone can be ambiguous — "Photos" may be
// at the top AND inside "Clients". A folder is named by its NAME when that is
// unique, or by its PATH ("Photos / Lisa's Farm", "Photos > Lisa's Farm").
// Only the member's OWN personal folders are ever matched.
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const svc = () => ({ apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}` });

export type MyFolder = { id: string; name: string; parent_id: string | null; path: string };

export async function myFolders(profileId: string): Promise<MyFolder[]> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/collections?owner_id=eq.${profileId}&space_id=is.null&select=id,name,parent_id&limit=2000`, { headers: svc() });
  const rows = (await r.json().catch(() => [])) as { id: string; name: string; parent_id: string | null }[];
  const list = Array.isArray(rows) ? rows : [];
  const by = new Map(list.map((f) => [f.id, f]));
  const pathOf = (f: { id: string; name: string; parent_id: string | null }) => {
    const parts = [f.name]; let cur = f.parent_id; let guard = 0;
    while (cur && guard++ < 14) { const p = by.get(cur); if (!p) break; parts.unshift(p.name); cur = p.parent_id; }
    return parts.join(' / ');
  };
  return list.map((f) => ({ ...f, path: pathOf(f) }));
}

const norm = (s: string) => s.toLowerCase().split(/\s*[/>›]\s*/).map((x) => x.trim()).filter(Boolean).join(' / ');

/** Resolve a folder the member named. Returns the folder, or an error that
 *  lists the choices when the name fits several. */
export async function resolveMyFolder(profileId: string, text: string, list?: MyFolder[]): Promise<{ folder?: MyFolder; error?: string }> {
  const want = norm(text);
  if (!want) return { error: 'Name the folder.' };
  const all = list ?? await myFolders(profileId);
  const byPath = all.filter((f) => norm(f.path) === want);
  if (byPath.length === 1) return { folder: byPath[0] };
  const last = want.split(' / ').pop()!;
  const byName = all.filter((f) => f.name.trim().toLowerCase() === last);
  // A partial path ("Lisa's Farm" or "Photos / Lisa's Farm" under a deeper parent)
  const tail = byName.filter((f) => norm(f.path).endsWith(want));
  const hits = tail.length ? tail : byName;
  if (hits.length === 1) return { folder: hits[0] };
  if (hits.length > 1) return { error: `Several folders are named "${last}": ${hits.map((f) => `"${f.path}"`).join(', ')} — name it by its path.` };
  return { error: `No folder of theirs is named "${text}" — read my_lists folders for the names and paths.` };
}
