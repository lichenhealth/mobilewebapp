import { supabase } from './supabase';

/** Where a licensed provider keeps HIPAA-grade clinical communication
 *  (founder 2026-11-12). Lichen POINTS there — it never imports clinical
 *  records, which would make Lichen a business associate. Members-only read. */
export type ClinicalHome = { service: string; url?: string | null; note?: string | null };

export const CLINICAL_SERVICES = [
  'SimplePractice', 'TherapyNotes', 'Jane', 'Spruce', 'Hushmail', 'Paubox',
  'Doxy.me', 'TheraNest', 'Sessions Health', 'IntakeQ', 'Ivy Pay',
];

export async function loadClinicalHome(profileId: string): Promise<ClinicalHome | null> {
  const { data } = await supabase.from('profiles').select('clinical_home').eq('id', profileId).maybeSingle();
  const v = (data as { clinical_home?: ClinicalHome | null } | null)?.clinical_home;
  return v && typeof v.service === 'string' && v.service.trim() ? v : null;
}

/** Normalize what someone typed; null clears. Throws plain words on a bad link. */
export function cleanClinicalHome(service: string, url: string, note: string): ClinicalHome | null {
  const s = service.trim().slice(0, 60);
  if (!s) return null;
  let u = url.trim();
  if (u && !/^https?:\/\//i.test(u)) u = 'https://' + u;
  if (u.startsWith('http://')) u = 'https://' + u.slice(7);
  if (u && !/^https:\/\/[^\s]{3,400}$/.test(u)) throw new Error('That link doesn’t look like a web address.');
  const n = note.trim().slice(0, 200);
  return { service: s, url: u || null, note: n || null };
}

export async function saveClinicalHome(profileId: string, value: ClinicalHome | null): Promise<void> {
  const { error } = await supabase.from('profiles').update({ clinical_home: value }).eq('id', profileId);
  if (error) throw new Error('That didn’t save — try again in a moment.');
}

export async function loadClinicalHomes(ids: string[]): Promise<Map<string, ClinicalHome>> {
  const out = new Map<string, ClinicalHome>();
  if (!ids.length) return out;
  const { data } = await supabase.from('profiles').select('id, clinical_home').in('id', ids.slice(0, 100));
  for (const r of (data ?? []) as { id: string; clinical_home: ClinicalHome | null }[]) {
    if (r.clinical_home?.service) out.set(r.id, r.clinical_home);
  }
  return out;
}
