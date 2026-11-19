// findMember — the ONE way an assistant tool turns a name the member typed
// into a Lichen person. Founder 2026-11-19: the brain couldn't find "Morghan
// Gray" because the member is "Morgahn Grey" — tools matched the full name
// EXACTLY. Now: exact first; otherwise a spelling-forgiving match (sound-alike
// normalising + edit distance per name part), with people already close to
// the member (care team, chats, shared groups, their web) weighed first.
//
// Never invents a target: one clear match returns it (the tool's card shows the
// real name before anything is sent); several close ones come back as
// candidates for the model to ASK about. Only findable members are considered,
// unless they're already close to the member (the can_see_profile rule).

type Sb = (path: string, init?: RequestInit) => Promise<Response>;
export type Found = { id: string; name: string };
export type FindResult =
  | { kind: 'match'; member: Found; exact: boolean }
  | { kind: 'several'; candidates: Found[] }
  | { kind: 'none' };

const arr = <T,>(x: unknown) => (Array.isArray(x) ? x : []) as T[];
const words = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z\s'-]/g, ' ').split(/[\s'-]+/).filter(Boolean);
/** Sound-alike key: Morghan/Morgahn/Morgan, Gray/Grey, Jon/John, Katherine/Catherine. */
function sound(w: string): string {
  return w.replace(/ph/g, 'f').replace(/^k/, 'c').replace(/ck/g, 'k')
    .replace(/(?<=.)h/g, '').replace(/[aeiouy]+$/g, 'e').replace(/(ey|ay|ai|ei)/g, 'e')
    .replace(/y/g, 'i').replace(/(.)\1+/g, '$1');
}
function lev(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
function wordSim(a: string, b: string): number {
  if (a === b) return 1;
  if (sound(a) === sound(b)) return 0.95;
  if (b.startsWith(a) && a.length >= 3) return 0.85; // "Kat" → "Katherine"
  const n = Math.max(a.length, b.length);
  return Math.max(0, 1 - lev(a, b) / n, 1 - lev(sound(a), sound(b)) / Math.max(sound(a).length, sound(b).length, 1));
}
/** How well the typed words fit a candidate's name (every typed word must land somewhere). */
function score(typed: string[], cand: string[]): number {
  if (!typed.length || !cand.length) return 0;
  let tot = 0;
  for (const t of typed) tot += Math.max(...cand.map((c) => wordSim(t, c)));
  return tot / typed.length;
}

async function closeIds(sb: Sb, me: string): Promise<Set<string>> {
  const out = new Set<string>();
  const [care1, care2, chats, spaces, web] = await Promise.all([
    sb(`care_team_members?patient_id=eq.${me}&select=caregiver_id`).then((r) => r.json()).catch(() => []),
    sb(`care_team_members?caregiver_id=eq.${me}&select=patient_id`).then((r) => r.json()).catch(() => []),
    sb(`chat_members?profile_id=eq.${me}&select=chat_id&limit=300`).then((r) => r.json()).catch(() => []),
    sb(`space_members?profile_id=eq.${me}&select=space_id&limit=200`).then((r) => r.json()).catch(() => []),
    sb(`mycelium?truster_id=eq.${me}&truster_space_id=is.null&target_type=eq.profile&select=target_id&limit=500`).then((r) => r.json()).catch(() => []),
  ]);
  for (const r of arr<{ caregiver_id: string }>(care1)) out.add(r.caregiver_id);
  for (const r of arr<{ patient_id: string }>(care2)) out.add(r.patient_id);
  for (const r of arr<{ target_id: string }>(web)) out.add(r.target_id);
  const chatIds = arr<{ chat_id: string }>(chats).map((r) => r.chat_id);
  if (chatIds.length) {
    const m = await sb(`chat_members?chat_id=in.(${chatIds.slice(0, 200).join(',')})&select=profile_id&limit=2000`).then((r) => r.json()).catch(() => []);
    for (const r of arr<{ profile_id: string }>(m)) out.add(r.profile_id);
  }
  const spaceIds = arr<{ space_id: string }>(spaces).map((r) => r.space_id);
  if (spaceIds.length) {
    const m = await sb(`space_members?space_id=in.(${spaceIds.slice(0, 100).join(',')})&select=profile_id&limit=3000`).then((r) => r.json()).catch(() => []);
    for (const r of arr<{ profile_id: string }>(m)) out.add(r.profile_id);
  }
  out.delete(me);
  return out;
}

export async function findMember(sb: Sb, me: string, raw: string): Promise<FindResult> {
  const typed = words(raw);
  if (!typed.length) return { kind: 'none' };
  const close = await closeIds(sb, me);
  type P = { id: string; full_name: string | null; findable: boolean | null };
  const seen = new Map<string, P>();
  const add = (rows: unknown) => { for (const p of arr<P>(rows)) if (p.id !== me && p.full_name) seen.set(p.id, p); };
  const base = '&kind=eq.person&onboarded=eq.true&select=id,full_name,findable&limit=40';
  // Exact first.
  add(await sb(`profiles?full_name=ilike.${encodeURIComponent(raw.trim().replace(/[%*]/g, ''))}${base}`).then((r) => r.json()).catch(() => []));
  const exact = [...seen.values()].filter((p) => p.findable || close.has(p.id));
  if (exact.length === 1) return { kind: 'match', member: { id: exact[0].id, name: exact[0].full_name! }, exact: true };
  if (exact.length > 1) {
    const near = exact.filter((p) => close.has(p.id));
    if (near.length === 1) return { kind: 'match', member: { id: near[0].id, name: near[0].full_name! }, exact: true };
    return { kind: 'several', candidates: exact.slice(0, 5).map((p) => ({ id: p.id, name: p.full_name! })) };
  }
  // Forgiving: anyone whose name shares the first two letters of a typed word,
  // plus everyone close to the member.
  const ors = [...new Set(typed.filter((w) => w.length >= 2).map((w) => `full_name.ilike.*${w.slice(0, 3)}*`))].slice(0, 6);
  if (ors.length) add(await sb(`profiles?or=(${ors.join(',')})${base.replace('limit=40', 'limit=400')}`).then((r) => r.json()).catch(() => []));
  if (close.size) add(await sb(`profiles?id=in.(${[...close].slice(0, 300).join(',')})${base.replace('limit=40', 'limit=300')}`).then((r) => r.json()).catch(() => []));
  const ranked = [...seen.values()]
    .filter((p) => p.findable || close.has(p.id))
    .map((p) => ({ p, s: score(typed, words(p.full_name!)) + (close.has(p.id) ? 0.04 : 0) }))
    .filter((x) => x.s >= 0.72)
    .sort((a, b) => b.s - a.s);
  if (!ranked.length) return { kind: 'none' };
  const [top, next] = ranked;
  if (top.s >= 0.84 && (!next || top.s - next.s >= 0.08)) return { kind: 'match', member: { id: top.p.id, name: top.p.full_name! }, exact: false };
  return { kind: 'several', candidates: ranked.slice(0, 5).map((x) => ({ id: x.p.id, name: x.p.full_name! })) };
}
