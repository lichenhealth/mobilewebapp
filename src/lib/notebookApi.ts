// THE BRAIN'S NOTEBOOK (founder 2026-11-25: "learns to proactively notify me
// over time when something is mission critical as they get to know me. You
// know the movie her?"). What the brain knows matters to a member — and what
// they don't want pings about. Owner-only RLS: it's theirs to read, add to
// and forget. The brain writes through its `remember` tool; the ping's two
// buttons and Profile → Connections write here.
import { supabase } from './supabase';

export type NotebookNote = { id: string; kind: 'matters' | 'quiet'; note: string; source: string; created_at: string };

export async function listNotebook(): Promise<NotebookNote[]> {
  const { data } = await supabase.from('assistant_memory')
    .select('id, kind, note, source, created_at').order('created_at', { ascending: false }).limit(200);
  return (data as NotebookNote[] | null) ?? [];
}

export async function addNote(me: string, kind: 'matters' | 'quiet', note: string, source: 'hand' | 'feedback' = 'hand'): Promise<void> {
  const text = note.trim().slice(0, 400);
  if (text.length < 2) throw new Error('Write a few words first.');
  const { error } = await supabase.from('assistant_memory').insert({ profile_id: me, kind, note: text, source });
  if (error) throw new Error(error.message);
}

export async function forgetNote(id: string): Promise<void> {
  const { error } = await supabase.from('assistant_memory').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

/** The words a ping's feedback writes — one rule, so the card can tell
 *  afterwards whether it was already answered. */
export function feedbackNote(kind: 'matters' | 'quiet', about: string, wish?: string): string {
  if (wish) return kind === 'matters' ? `Glad to hear about listings like "${about}"` : `Not a fit for the wish "${wish}": listings like "${about}"`;
  return kind === 'matters' ? `Glad I was told about: ${about}` : `Don't ping about mail like: ${about}`;
}
