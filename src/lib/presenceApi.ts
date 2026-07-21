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

export interface MyPresence {
  visible: boolean;               // ALWAYS mode: show whenever awake
  litUntil: string | null;        // BY-HAND mode: candle lit until this moment
}

/** My own presence choice — null when the feature isn't live yet. */
export async function myPresence(me: string): Promise<MyPresence | null> {
  const { data, error } = await supabase.from('profiles')
    .select('presence_visible, presence_lit_until').eq('id', me).maybeSingle();
  if (error) return null;
  const d = data as { presence_visible?: boolean; presence_lit_until?: string | null } | null;
  if (d?.presence_visible === undefined) return null;
  return { visible: d.presence_visible ?? false, litUntil: d.presence_lit_until ?? null };
}

/** ALWAYS mode on/off. Turning it on snuffs any hand-lit candle (redundant). */
export async function setPresenceVisible(me: string, on: boolean): Promise<void> {
  const { error } = await supabase.from('profiles')
    .update({ presence_visible: on, ...(on ? { presence_lit_until: null } : {}) }).eq('id', me);
  if (error) throw error;
}

/** Light the candle by hand — visible for `hours`, then it fades on its own. */
export async function lightPresence(me: string, hours = 4): Promise<string> {
  const until = new Date(Date.now() + hours * 3600_000).toISOString();
  const { error } = await supabase.from('profiles')
    .update({ presence_lit_until: until }).eq('id', me);
  if (error) throw error;
  return until;
}

export async function snuffPresence(me: string): Promise<void> {
  const { error } = await supabase.from('profiles')
    .update({ presence_lit_until: null }).eq('id', me);
  if (error) throw error;
}

export const candleLit = (p: MyPresence | null): boolean =>
  !!p?.litUntil && new Date(p.litUntil).getTime() > Date.now();
