import { supabase } from './supabase';
import { occursOn, type Recurrence } from './recurrence';

// ─── Reminders (Gabe's suggestion, 2026-07-18) ───────────────────────────────
// Private calendar nudges — no guests, no RSVP, never counted as busy.
// Recurrence is the platform's RRULE-lite jsonb; expand with occursOn().

export interface Reminder {
  id: string;
  profile_id: string;
  title: string;
  start_date: string;
  end_date: string;
  at_min: number | null;    // null = day reminder (morning nudge)
  lead_min: number;
  recurrence: Recurrence | null;
}

const COLS = 'id, profile_id, title, start_date, end_date, at_min, lead_min, recurrence';

export async function listReminders(me: string): Promise<Reminder[]> {
  const { data, error } = await supabase.from('reminders')
    .select(COLS).eq('profile_id', me).order('created_at');
  if (error) { console.warn('listReminders:', error.message); return []; }
  return (data as Reminder[] | null) ?? [];
}

export async function createReminder(
  me: string,
  r: { title: string; date: string; atMin: number | null; leadMin: number; recurrence: Recurrence | null },
): Promise<void> {
  const { error } = await supabase.from('reminders').insert({
    profile_id: me, title: r.title, start_date: r.date, end_date: r.date,
    at_min: r.atMin, lead_min: r.leadMin, recurrence: r.recurrence,
  });
  if (error) throw error;
}

/** One reminder by id (for the edit composer). */
export async function getReminder(id: string): Promise<Reminder | null> {
  const { data, error } = await supabase.from('reminders').select(COLS).eq('id', id).maybeSingle();
  if (error) { console.warn('getReminder:', error.message); return null; }
  return (data as Reminder | null) ?? null;
}

export async function updateReminder(
  me: string, id: string,
  r: { title: string; date: string; atMin: number | null; leadMin: number; recurrence: Recurrence | null },
): Promise<void> {
  const { error } = await supabase.from('reminders').update({
    title: r.title, start_date: r.date, end_date: r.date,
    at_min: r.atMin, lead_min: r.leadMin, recurrence: r.recurrence,
  }).eq('id', id).eq('profile_id', me);
  if (error) throw error;
}

export async function deleteReminder(me: string, id: string): Promise<void> {
  const { error } = await supabase.from('reminders').delete().eq('id', id).eq('profile_id', me);
  if (error) throw error;
}

/** Occurrences of my reminders on one day. */
export function remindersOn(all: Reminder[], iso: string): Reminder[] {
  return all.filter((r) => occursOn(r, iso));
}

export async function listDone(reminderIds: string[], from: string, to: string): Promise<Set<string>> {
  if (reminderIds.length === 0) return new Set();
  const { data, error } = await supabase.from('reminder_done')
    .select('reminder_id, on_date')
    .in('reminder_id', reminderIds).gte('on_date', from).lte('on_date', to);
  if (error) { console.warn('listDone:', error.message); return new Set(); }
  return new Set(((data as { reminder_id: string; on_date: string }[] | null) ?? [])
    .map((d) => `${d.reminder_id}:${d.on_date}`));
}

export async function setDone(reminderId: string, iso: string, done: boolean): Promise<void> {
  if (done) {
    const { error } = await supabase.from('reminder_done')
      .upsert({ reminder_id: reminderId, on_date: iso }, { onConflict: 'reminder_id,on_date' });
    if (error) throw error;
  } else {
    const { error } = await supabase.from('reminder_done')
      .delete().eq('reminder_id', reminderId).eq('on_date', iso);
    if (error) throw error;
  }
}
