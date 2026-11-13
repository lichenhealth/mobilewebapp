import { supabase } from './supabase';

/** A practitioner's revenue streams (founder 2026-11-12) — their OWN business
 *  facts: for each service, the rate that makes the work feasible and what
 *  each payer covers. Owner-only (RLS). The care-plan payment box reads
 *  them to pre-shape an ask. Never client data. */
export type StreamKind = 'cash' | 'sliding' | 'insurance_in' | 'insurance_out' | 'public' | 'contract' | 'other';
export type Stream = {
  id: string;
  owner_id: string;
  service: string;
  rate_cents: number;
  label: string;
  kind: StreamKind;
  pays_cents: number | null;
  pays_pct: number | null;
  note: string | null;
  sort: number;
};

export const STREAM_KINDS: { key: StreamKind; label: string }[] = [
  { key: 'cash', label: 'Client pays in full' },
  { key: 'sliding', label: 'Sliding scale' },
  { key: 'insurance_in', label: 'Insurance — in network' },
  { key: 'insurance_out', label: 'Insurance — out of network' },
  { key: 'public', label: 'Public program (Medi-Cal, Medicare, VA…)' },
  { key: 'contract', label: 'Contract or grant' },
  { key: 'other', label: 'Something else' },
];

const COLS = 'id, owner_id, service, rate_cents, label, kind, pays_cents, pays_pct, note, sort';

export async function listMyStreams(me: string): Promise<Stream[]> {
  const { data } = await supabase.from('practitioner_streams').select(COLS)
    .eq('owner_id', me).order('service').order('sort').order('created_at');
  return (data as Stream[] | null) ?? [];
}

export async function saveStream(me: string, s: Omit<Stream, 'id' | 'owner_id' | 'sort'> & { id?: string; sort?: number }): Promise<Stream> {
  const row = {
    owner_id: me, service: s.service.trim(), rate_cents: s.rate_cents, label: s.label.trim(), kind: s.kind,
    pays_cents: s.pays_pct ? null : s.pays_cents, pays_pct: s.pays_pct || null,
    note: s.note?.trim() || null, sort: s.sort ?? 0,
  };
  const q = s.id
    ? supabase.from('practitioner_streams').update(row).eq('id', s.id).select(COLS).single()
    : supabase.from('practitioner_streams').insert(row).select(COLS).single();
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data as Stream;
}

export async function deleteStream(id: string): Promise<void> {
  const { error } = await supabase.from('practitioner_streams').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

/** What this stream covers of its service's rate, in cents. Cash/sliding
 *  cover nothing from outside — the client is the payer. */
export function coveredBy(s: Stream): number {
  if (s.kind === 'cash' || s.kind === 'sliding') return 0;
  if (s.pays_pct) return Math.round((s.rate_cents * s.pays_pct) / 100);
  return Math.min(s.pays_cents ?? 0, s.rate_cents);
}
/** The gap a stream leaves: what the client pays, or a subsidy asks for. */
export const gapOf = (s: Stream) => Math.max(0, s.rate_cents - coveredBy(s));

export const usd = (c: number) => '$' + (c / 100).toFixed(2).replace(/\.00$/, '');
