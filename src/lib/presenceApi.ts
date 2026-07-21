import { supabase } from './supabase';

// ─── Presence, given not taken (founder 2026-07-19) ──────────────────────────
// The Home greeting's awake count opens a panel showing ONLY network members
// who CHOSE visibility (profiles.presence_visible, default off). Coarse by
// design: names, no timestamps, no ambient dots anywhere else.

export interface AwakeMember {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  headline: string | null;
}

/** Network members awake now who opted in — [] until the migration runs. */
export async function awakeList(): Promise<AwakeMember[]> {
  const { data, error } = await supabase.rpc('network_awake_list');
  if (error) { console.warn('network_awake_list:', error.message); return []; }
  return (data as AwakeMember[] | null) ?? [];
}

/** My own visibility choice — null when the feature isn't live yet. */
export async function myPresenceVisible(me: string): Promise<boolean | null> {
  const { data, error } = await supabase.from('profiles')
    .select('presence_visible').eq('id', me).maybeSingle();
  if (error) return null;
  return (data as { presence_visible?: boolean } | null)?.presence_visible ?? null;
}

export async function setPresenceVisible(me: string, on: boolean): Promise<void> {
  const { error } = await supabase.from('profiles')
    .update({ presence_visible: on }).eq('id', me);
  if (error) throw error;
}
