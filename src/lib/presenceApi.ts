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
  lit?: boolean;   // candle hand-lit = "present, open to connect"; else "around"
  me?: boolean;    // you, inside a space's own list — shown as "you", not a name
}

/** Network members awake now who opted in — [] until the migration runs. */
export async function awakeList(): Promise<AwakeMember[]> {
  const { data, error } = await supabase.rpc('network_awake_list');
  if (error) { console.warn('network_awake_list:', error.message); return []; }
  return (data as AwakeMember[] | null) ?? [];
}

export interface MyPresence {
  visible: boolean;               // AROUND (dot): show I'm online — default on
  alwaysPresent: boolean;         // PRESENT (candle) whenever online
  litUntil: string | null;        // PRESENT (candle) lit by hand until this moment
}

/** My own presence choice — null when the feature isn't live yet. */
export async function myPresence(me: string): Promise<MyPresence | null> {
  const { data, error } = await supabase.from('profiles')
    .select('presence_visible, presence_always_present, presence_lit_until').eq('id', me).maybeSingle();
  if (error) return null;
  const d = data as { presence_visible?: boolean; presence_always_present?: boolean; presence_lit_until?: string | null } | null;
  if (d?.presence_visible === undefined) return null;
  return {
    visible: d.presence_visible ?? true,
    alwaysPresent: d.presence_always_present ?? false,
    litUntil: d.presence_lit_until ?? null,
  };
}

/** AROUND (the dot) on/off — independent of the candle. */
export async function setPresenceVisible(me: string, on: boolean): Promise<void> {
  const { error } = await supabase.from('profiles')
    .update({ presence_visible: on }).eq('id', me);
  if (error) throw error;
}

/** PRESENT-always (candle whenever online) on/off. */
export async function setAlwaysPresent(me: string, on: boolean): Promise<void> {
  const { error } = await supabase.from('profiles')
    .update({ presence_always_present: on }).eq('id', me);
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

/** Presence inside ONE layer — a community, a group, a place (founder
 *  2026-08-06: "each sub layer of the network to have its own feed where only
 *  those awake within that sub community are shown"). Members only; the same
 *  opt-ins and the same names-only, no-timestamps rule as the whole-web view. */
export async function spaceAwakeCount(spaceId: string): Promise<number | null> {
  const { data, error } = await supabase.rpc('space_awake_count', { p_space: spaceId });
  if (error) return null;   // pre-migration: the line simply doesn't render
  return (data as number) ?? 0;
}

export async function spaceAwakeList(spaceId: string): Promise<AwakeMember[]> {
  const { data, error } = await supabase.rpc('space_awake_list', { p_space: spaceId });
  if (error) return [];
  return (data as AwakeMember[] | null) ?? [];
}
