// Spelling & grammar suggestions (founder 2026-11-19: "as google would in
// gmail"). The text is checked and forgotten server-side; every fix is the
// member's own tap. One switch governs it: Profile → Privacy → "Spelling &
// grammar suggestions" (consent section 'writing').
import { supabase } from './supabase';

export type Suggestion = { original: string; replacement: string; kind: string; note: string };

export async function proofread(text: string): Promise<Suggestion[]> {
  const { data, error } = await supabase.functions.invoke('proofread', { body: { text } });
  if (error) return [];
  return Array.isArray(data?.suggestions) ? data.suggestions as Suggestion[] : [];
}

/** Apply one suggestion to the text as it stands now (first exact occurrence). */
export function applySuggestion(text: string, s: Suggestion): string {
  const i = text.indexOf(s.original);
  return i < 0 ? text : text.slice(0, i) + s.replacement + text.slice(i + s.original.length);
}
