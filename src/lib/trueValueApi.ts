import { supabase } from './supabase';

// THE TRUE VALUE LAYER (founder 2026-11-16: "what is valued and how value is
// exchanged today, versus the true value that should be exchanged in a fully
// reciprocal and inclusive economy (that includes land, animals, plants and
// elements)"). Each row is ONE person's private note — owner-only RLS. A
// record, never a balance: nothing here entitles anyone to anything.

export type TrueValueSource = 'exchange' | 'session' | 'order' | 'manual';
export interface TrueValue {
  id: string;
  source: TrueValueSource;
  source_id: string | null;
  direction: 'given' | 'received';
  title: string | null;
  counterparty: string | null;
  being_id: string | null;
  being?: { full_name: string | null; kind: string | null } | null;
  exchanged_cents: number | null;
  true_cents: number;
  note: string | null;
  at: string;
  /** Honor system, with a check: counts the moment it's set; a steward's
   *  look follows (reviewed ✓ or a question), never a gate. */
  review_status: 'pending' | 'reviewed' | 'questioned';
  review_note: string | null;
}

const COLS = 'id, source, source_id, direction, title, counterparty, being_id, exchanged_cents, true_cents, note, at, review_status, review_note, being:profiles!true_values_being_id_fkey(full_name, kind)';

export async function listTrueValues(): Promise<TrueValue[]> {
  const { data, error } = await supabase.from('true_values').select(COLS).order('at', { ascending: false }).limit(300);
  if (error) throw new Error(error.message);
  return (data as unknown as TrueValue[]) ?? [];
}

/** The true value of something that already happened on Lichen (one per row). */
export async function saveTrueValueFor(src: { source: Exclude<TrueValueSource, 'manual'>; source_id: string; direction: 'given' | 'received'; title: string; counterparty: string | null; exchanged_cents: number | null; at: string },
  true_cents: number, note: string | null): Promise<TrueValue> {
  const { data: existing } = await supabase.from('true_values').select('id')
    .eq('source', src.source).eq('source_id', src.source_id).maybeSingle();
  const row = { ...src, true_cents, note };
  const q = existing
    ? supabase.from('true_values').update(row).eq('id', (existing as { id: string }).id)
    : supabase.from('true_values').insert(row);
  const { data, error } = await q.select(COLS).single();
  if (error) throw new Error(error.message);
  return data as unknown as TrueValue;
}

/** A value that never passed through Lichen — a being's medicine, a neighbor's help. */
export async function addManualTrueValue(v: { direction: 'given' | 'received'; title: string; counterparty: string | null; being_id: string | null; exchanged_cents: number | null; true_cents: number; note: string | null }): Promise<TrueValue> {
  const { data, error } = await supabase.from('true_values').insert({ ...v, source: 'manual' }).select(COLS).single();
  if (error) throw new Error(error.message);
  return data as unknown as TrueValue;
}

export async function deleteTrueValue(id: string): Promise<void> {
  const { error } = await supabase.from('true_values').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

/** Stewarded members (plants, animals, places, elements, collectives) by name. */
export async function searchBeings(q: string): Promise<{ id: string; full_name: string; kind: string }[]> {
  const { data } = await supabase.from('profiles').select('id, full_name, kind')
    .neq('kind', 'person').ilike('full_name', `%${q.trim()}%`).limit(6);
  return (data as { id: string; full_name: string; kind: string }[] | null) ?? [];
}
