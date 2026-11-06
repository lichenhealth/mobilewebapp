import { supabase } from './supabase';
import { APP_ORIGIN } from './customDomain';

// GUEST LISTS — a member's private address book (founder 2026-11-06).
// `entries` hold the SAME chip shapes Compose's Who's-invited box holds;
// `space_ids` are whole circles. Owner-only RLS; no assistant reads these.

export type ListEntry =
  | { kind: 'member'; id: string; name: string }
  | { kind: 'email'; value: string; name: string }
  | { kind: 'phone'; value: string; sms: string; name: string };

export type GuestList = {
  id: string;
  name: string;
  entries: ListEntry[];
  space_ids: string[];
  updated_at?: string;
};

export async function listGuestLists(ownerId: string): Promise<GuestList[]> {
  const { data } = await supabase.from('guest_lists')
    .select('id, name, entries, space_ids, updated_at')
    .eq('owner_id', ownerId).order('updated_at', { ascending: false });
  return (data as GuestList[] | null) ?? [];
}

export async function createGuestList(ownerId: string, name: string, entries: ListEntry[] = [], spaceIds: string[] = []) {
  const { data, error } = await supabase.from('guest_lists')
    .insert({ owner_id: ownerId, name: name.trim(), entries, space_ids: spaceIds })
    .select('id, name, entries, space_ids, updated_at').single();
  if (error) throw new Error(error.code === '23505' ? 'You already have a list with that name.' : error.message);
  return data as GuestList;
}

export async function updateGuestList(id: string, patch: Partial<Pick<GuestList, 'name' | 'entries' | 'space_ids'>>) {
  const { error } = await supabase.from('guest_lists')
    .update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) throw new Error(error.code === '23505' ? 'You already have a list with that name.' : error.message);
}

export async function deleteGuestList(id: string) {
  await supabase.from('guest_lists').delete().eq('id', id);
}

export const entryKey = (e: ListEntry) => e.kind === 'member' ? `m:${e.id}` : `${e.kind}:${e.value}`;

export function entryLabel(e: ListEntry): string {
  if (e.kind === 'member') return e.name;
  return e.name ? `${e.name} · ${e.value}` : e.value;
}

// ── EXPORT ──────────────────────────────────────────────────────────────
// A row the exporters understand: a name plus whatever contact the person
// legitimately holds. A member on YOUR list exports as name + profile link
// only — their private email/phone was never yours to carry out.
export type ExportRow = { name: string; email?: string; phone?: string; url?: string; note?: string };

export function listToRows(list: GuestList): ExportRow[] {
  return list.entries.map((e) => e.kind === 'member'
    ? { name: e.name, url: `${APP_ORIGIN}/members/${e.id}` }
    : e.kind === 'email' ? { name: e.name || '', email: e.value }
    : { name: e.name || '', phone: e.sms || e.value });
}

const csvCell = (v: string | undefined) => {
  const s = v ?? '';
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv(rows: ExportRow[]): string {
  const head = ['Name', 'Email', 'Phone', 'Lichen profile', 'Note'];
  const lines = rows.map((r) => [r.name, r.email, r.phone, r.url, r.note].map(csvCell).join(','));
  return [head.join(','), ...lines].join('\r\n') + '\r\n';
}

const vEsc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');

export function toVcf(rows: ExportRow[]): string {
  return rows.map((r) => {
    const name = r.name || r.email || r.phone || 'Contact';
    const parts = name.trim().split(/\s+/);
    const last = parts.length > 1 ? parts[parts.length - 1] : '';
    const first = parts.length > 1 ? parts.slice(0, -1).join(' ') : parts[0];
    const lines = ['BEGIN:VCARD', 'VERSION:3.0', `FN:${vEsc(name)}`, `N:${vEsc(last)};${vEsc(first)};;;`];
    if (r.email) lines.push(`EMAIL;TYPE=INTERNET:${vEsc(r.email)}`);
    if (r.phone) lines.push(`TEL;TYPE=CELL:${vEsc(r.phone)}`);
    if (r.url) lines.push(`URL:${vEsc(r.url)}`);
    if (r.note) lines.push(`NOTE:${vEsc(r.note)}`);
    lines.push('END:VCARD');
    return lines.join('\r\n');
  }).join('\r\n') + '\r\n';
}

export function fileSafe(name: string): string {
  return name.trim().replace(/[^\w\- ]+/g, '').replace(/\s+/g, '-').toLowerCase() || 'contacts';
}

export function downloadText(filename: string, text: string, mime: string) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function exportRows(base: string, rows: ExportRow[], fmt: 'csv' | 'vcf') {
  if (fmt === 'csv') downloadText(`${fileSafe(base)}.csv`, toCsv(rows), 'text/csv;charset=utf-8');
  else downloadText(`${fileSafe(base)}.vcf`, toVcf(rows), 'text/vcard;charset=utf-8');
}
