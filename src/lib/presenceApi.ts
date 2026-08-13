import { supabase } from './supabase';
import { freeBusy } from './calendarApi';
import { occursOn } from './recurrence';

// ─── Presence, given not taken (founder 2026-07-19) ──────────────────────────
// PRESENT MEANS A LIT CANDLE, AND NOTHING ELSE (founder 2026-08-13): the
// candle says "I'm open to live engagement", as against being online just to
// get things done. Being online was never a choice anyone made, so it is no
// longer a signal — these lists return only people whose candle is lit.
// Coarse by design: names, no timestamps, no ambient dots anywhere.

export interface AwakeMember {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  headline: string | null;
  lit?: boolean;   // always true now — everyone returned here is present
  me?: boolean;    // you, inside a space's own list — shown as "you", not a name
}

/** Members of your web who are PRESENT — candle lit and here this minute. */
export async function presentList(): Promise<AwakeMember[]> {
  const { data, error } = await supabase.rpc('network_present_list');
  if (error) { console.warn('network_present_list:', error.message); return []; }
  return (data as AwakeMember[] | null) ?? [];
}

/** Members of your web who are AVAILABLE — inside their published hours,
 *  minus whatever is booked (founder 2026-08-13: "I just want people to be
 *  offline as much as possible, but be able to signal when they're
 *  available"). Disjoint from present: the SQL already drops anyone who is
 *  here right now, so a person is only ever counted once.
 *
 *  The booked-subtraction happens HERE, not in SQL, because recurrence lives
 *  in exactly one place (recurrence.ts, shared with the calendar, reminders
 *  and fire-reminders) and a second expander in SQL would fork the engine.
 *  The candidate set is only people currently in-hours, so this stays cheap.
 *  ⚠ If a web ever runs to thousands, revisit — a SQL expander or a cached
 *  rollup, not a bigger loop. */
export async function availableList(): Promise<AwakeMember[]> {
  const { data, error } = await supabase.rpc('network_available_list');
  if (error) { console.warn('network_available_list:', error.message); return []; }
  const rows = (data as (AwakeMember & { local_date: string; local_min: number })[] | null) ?? [];
  if (!rows.length) return [];

  // Their own clock, not the viewer's: 2pm busy means 2pm where they are.
  const dates = [...new Set(rows.map((r) => r.local_date))].sort();
  const busy = await freeBusy(rows.map((r) => r.id), dates[0], dates[dates.length - 1]);

  return rows.filter((r) => !busy.some((e) => {
    if (e.profile_id !== r.id) return false;
    if (!occursOn(e, r.local_date)) return false;
    if (e.all_day) return true;
    if (e.start_min == null || e.end_min == null) return true;   // untimed: treat as busy
    return r.local_min >= e.start_min && r.local_min < e.end_min;
  }));
}

export interface MyPresence {
  /** Retired 2026-08-13 — the column is still read so myPresence() can tell a
   *  pre-migration database apart, but nothing shows who is merely online. */
  visible: boolean;
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
export async function spacePresentCount(spaceId: string): Promise<number | null> {
  const { data, error } = await supabase.rpc('space_present_count', { p_space: spaceId });
  if (error) return null;   // pre-migration: the line simply doesn't render
  return (data as number) ?? 0;
}

export async function spacePresentList(spaceId: string): Promise<AwakeMember[]> {
  const { data, error } = await supabase.rpc('space_present_list', { p_space: spaceId });
  if (error) return [];
  return (data as AwakeMember[] | null) ?? [];
}
