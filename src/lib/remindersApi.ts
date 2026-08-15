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
  /** shared = whoever ticks it completes it for everyone (the default for an
   *  assigned task — the horses only need bringing in once); each = every
   *  recipient ticks their own copy (founder 2026-08-14). */
  done_mode?: 'shared' | 'each';
  /** The owner's name — set on rows ASSIGNED to you (profile_id ≠ you), so
   *  the list can say whose task it is. */
  owner?: { full_name: string | null } | null;
}

// A shared-nudge recipient — a person or a whole space (org/group/community).
export interface Recipient { type: 'profile' | 'space'; id: string; name?: string }

const COLS = 'id, profile_id, title, start_date, end_date, at_min, lead_min, recurrence, done_mode';

async function writeRecipients(reminderId: string, recipients: Recipient[]): Promise<void> {
  await supabase.from('reminder_recipients').delete().eq('reminder_id', reminderId);
  if (recipients.length) {
    await supabase.from('reminder_recipients')
      .insert(recipients.map((r) => ({ reminder_id: reminderId, recipient_type: r.type, recipient_id: r.id })));
    await supabase.rpc('notify_reminder', { p_reminder: reminderId }).then(() => {}, () => {});
  }
}

/** Recipients for MANY reminders at once, name-resolved — the To-Do list
 *  says who's on a task without a click-through (founder 2026-08-14), so it
 *  must not cost one query per row. */
export async function loadRecipientsFor(ids: string[]): Promise<Map<string, Recipient[]>> {
  const out = new Map<string, Recipient[]>();
  if (ids.length === 0) return out;
  const { data } = await supabase.from('reminder_recipients')
    .select('reminder_id, recipient_type, recipient_id').in('reminder_id', ids);
  const rows = (data as { reminder_id: string; recipient_type: 'profile' | 'space'; recipient_id: string }[] | null) ?? [];
  if (rows.length === 0) return out;
  const profIds = [...new Set(rows.filter((r) => r.recipient_type === 'profile').map((r) => r.recipient_id))];
  const spaceIds = [...new Set(rows.filter((r) => r.recipient_type === 'space').map((r) => r.recipient_id))];
  const [profs, spaces] = await Promise.all([
    profIds.length ? supabase.from('profiles').select('id, full_name').in('id', profIds) : Promise.resolve({ data: [] }),
    spaceIds.length ? supabase.from('spaces').select('id, name').in('id', spaceIds) : Promise.resolve({ data: [] }),
  ]);
  const pName = new Map(((profs.data as { id: string; full_name: string | null }[] | null) ?? []).map((p) => [p.id, p.full_name ?? 'Member']));
  const sName = new Map(((spaces.data as { id: string; name: string }[] | null) ?? []).map((x) => [x.id, x.name]));
  for (const r of rows) {
    const list = out.get(r.reminder_id) ?? [];
    list.push({
      type: r.recipient_type, id: r.recipient_id,
      name: r.recipient_type === 'profile' ? pName.get(r.recipient_id) : sName.get(r.recipient_id),
    });
    out.set(r.reminder_id, list);
  }
  return out;
}

/** Recipients of a reminder, name-resolved (for the edit composer). */
export async function loadReminderRecipients(reminderId: string): Promise<Recipient[]> {
  const { data } = await supabase.from('reminder_recipients')
    .select('recipient_type, recipient_id').eq('reminder_id', reminderId);
  const rows = (data as { recipient_type: 'profile' | 'space'; recipient_id: string }[] | null) ?? [];
  if (rows.length === 0) return [];
  const profIds = rows.filter((r) => r.recipient_type === 'profile').map((r) => r.recipient_id);
  const spaceIds = rows.filter((r) => r.recipient_type === 'space').map((r) => r.recipient_id);
  const [profs, spaces] = await Promise.all([
    profIds.length ? supabase.from('profiles').select('id, full_name').in('id', profIds) : Promise.resolve({ data: [] }),
    spaceIds.length ? supabase.from('spaces').select('id, name').in('id', spaceIds) : Promise.resolve({ data: [] }),
  ]);
  const pName = new Map(((profs.data as { id: string; full_name: string | null }[] | null) ?? []).map((p) => [p.id, p.full_name ?? 'Member']));
  const sName = new Map(((spaces.data as { id: string; name: string }[] | null) ?? []).map((s) => [s.id, s.name]));
  return rows.map((r) => ({
    type: r.recipient_type, id: r.recipient_id,
    name: r.recipient_type === 'profile' ? pName.get(r.recipient_id) : sName.get(r.recipient_id),
  }));
}

/** Your reminders AND the ones assigned to you (founder 2026-08-14 — the
 *  assignment machinery existed for a year of Thursdays but the client only
 *  ever loaded your own rows; RLS was already right). No owner filter: RLS
 *  returns what you own plus what names you (directly or via a space). */
export async function listReminders(me: string): Promise<Reminder[]> {
  const { data, error } = await supabase.from('reminders')
    .select(COLS + ', owner:profiles!reminders_profile_id_fkey(full_name)')
    .order('created_at');
  if (error) {
    // Pre-migration fallback: owned rows only, no owner join.
    const own = await supabase.from('reminders').select(COLS).eq('profile_id', me).order('created_at');
    return (own.data as Reminder[] | null) ?? [];
  }
  return (data as unknown as Reminder[] | null) ?? [];
}

/** Step out of a task someone assigned to you — deletes YOUR recipient row
 *  (the "reminder_recipients leave" policy); the owner's task is untouched. */
export async function leaveReminder(reminderId: string, me: string): Promise<void> {
  const { error } = await supabase.from('reminder_recipients')
    .delete().eq('reminder_id', reminderId)
    .eq('recipient_type', 'profile').eq('recipient_id', me);
  if (error) throw error;
}

export async function createReminder(
  me: string,
  r: { title: string; date: string; atMin: number | null; leadMin: number; recurrence: Recurrence | null; doneMode?: 'shared' | 'each' },
  recipients: Recipient[] = [],
): Promise<void> {
  const { data, error } = await supabase.from('reminders').insert({
    profile_id: me, title: r.title, start_date: r.date, end_date: r.date,
    at_min: r.atMin, lead_min: r.leadMin, recurrence: r.recurrence,
    done_mode: r.doneMode ?? 'shared',
  }).select('id').single();
  if (error) throw error;
  if (recipients.length) await writeRecipients((data as { id: string }).id, recipients);
}

/** One reminder by id (for the edit composer). */
export async function getReminder(id: string): Promise<Reminder | null> {
  const { data, error } = await supabase.from('reminders').select(COLS).eq('id', id).maybeSingle();
  if (error) { console.warn('getReminder:', error.message); return null; }
  return (data as Reminder | null) ?? null;
}

export async function updateReminder(
  me: string, id: string,
  r: { title: string; date: string; atMin: number | null; leadMin: number; recurrence: Recurrence | null; doneMode?: 'shared' | 'each' },
  recipients?: Recipient[],
): Promise<void> {
  const { error } = await supabase.from('reminders').update({
    title: r.title, start_date: r.date, end_date: r.date,
    at_min: r.atMin, lead_min: r.leadMin, recurrence: r.recurrence,
    ...(r.doneMode ? { done_mode: r.doneMode } : {}),
  }).eq('id', id).eq('profile_id', me);
  if (error) throw error;
  if (recipients) await writeRecipients(id, recipients);
}

export async function deleteReminder(me: string, id: string): Promise<void> {
  const { error } = await supabase.from('reminders').delete().eq('id', id).eq('profile_id', me);
  if (error) throw error;
}

/** Occurrences of my reminders on one day. */
export function remindersOn(all: Reminder[], iso: string): Reminder[] {
  return all.filter((r) => occursOn(r, iso));
}

/** Who finished a task on a day. On a SHARED task anyone's tick counts (and
 *  names them); on an EACH task only your own does. */
export interface DoneBy { profileId: string; name: string | null }

export async function listDone(
  me: string, reminders: Reminder[] | string[], from: string, to: string,
): Promise<Map<string, DoneBy>> {
  const out = new Map<string, DoneBy>();
  // Tolerates the old id-array shape; ids alone mean "treat as each-of-us".
  const rems: Reminder[] = (reminders as unknown[]).every((r) => typeof r === 'string')
    ? (reminders as string[]).map((id) => ({ id, done_mode: 'each' } as Reminder))
    : (reminders as Reminder[]);
  if (rems.length === 0) return out;
  const modeOf = new Map(rems.map((r) => [r.id, r.done_mode ?? 'shared']));
  const { data, error } = await supabase.from('reminder_done')
    .select('reminder_id, profile_id, on_date, profiles(full_name)')
    .in('reminder_id', rems.map((r) => r.id)).gte('on_date', from).lte('on_date', to);
  if (error) { console.warn('listDone:', error.message); return out; }
  for (const d of ((data as unknown as { reminder_id: string; profile_id: string; on_date: string; profiles?: { full_name: string | null } | null }[] | null) ?? [])) {
    const shared = modeOf.get(d.reminder_id) !== 'each';
    if (!shared && d.profile_id !== me) continue;   // their copy, not yours
    const key = `${d.reminder_id}:${d.on_date}`;
    // Your own tick wins the label when both exist.
    if (!out.has(key) || d.profile_id === me) {
      out.set(key, { profileId: d.profile_id, name: d.profiles?.full_name ?? null });
    }
  }
  return out;
}

export async function setDone(
  me: string, reminderId: string, iso: string, done: boolean,
  mode: 'shared' | 'each' = 'shared',
): Promise<void> {
  if (done) {
    const { error } = await supabase.from('reminder_done')
      .upsert({ reminder_id: reminderId, profile_id: me, on_date: iso }, { onConflict: 'reminder_id,profile_id,on_date' });
    if (error) throw error;
  } else {
    // Reopening a SHARED job clears whoever's tick closed it; on an
    // each-of-us task you only ever clear your own.
    let q = supabase.from('reminder_done').delete().eq('reminder_id', reminderId).eq('on_date', iso);
    if (mode === 'each') q = q.eq('profile_id', me);
    const { error } = await q;
    if (error) throw error;
  }
}
