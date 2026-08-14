import { supabase } from './supabase';
import type { Recurrence } from './recurrence';

// ─── Task visibility (founder 2026-08-14) ────────────────────────────────────
// "Make my tasks visible to X" — location_shares' audience-rule pattern:
// everyone / mycelium / space / profile, exclusion = a specific rule set to
// 'hidden', most-restrictive wins at equal specificity, DEFAULT HIDDEN.
// A task list is undone work; nothing shows unless its owner opens it.

export type TaskLevel = 'hidden' | 'see';

export interface TaskShareRule {
  id: string;
  audience_type: 'everyone' | 'mycelium' | 'space' | 'profile';
  audience_space_id: string | null;
  audience_profile_id: string | null;
  level: TaskLevel;
  space?: { name: string } | null;
  profile?: { full_name: string | null } | null;
}

const RULE_COLS = 'id, audience_type, audience_space_id, audience_profile_id, level, ' +
  'space:spaces(name), profile:profiles!task_shares_audience_profile_id_fkey(full_name)';

export async function loadMyTaskShares(me: string): Promise<TaskShareRule[]> {
  const { data, error } = await supabase.from('task_shares')
    .select(RULE_COLS).eq('owner_id', me).order('created_at');
  if (error) { console.warn('loadMyTaskShares:', error.message); return []; }
  return (data as unknown as TaskShareRule[] | null) ?? [];
}

/** One rule per audience — delete-then-insert, the calendar_shares idiom. */
export async function upsertTaskShare(
  me: string,
  audience: { type: 'everyone' | 'mycelium' } | { type: 'space'; id: string } | { type: 'profile'; id: string },
  level: TaskLevel,
): Promise<void> {
  let del = supabase.from('task_shares').delete().eq('owner_id', me).eq('audience_type', audience.type);
  if (audience.type === 'space') del = del.eq('audience_space_id', audience.id);
  if (audience.type === 'profile') del = del.eq('audience_profile_id', audience.id);
  await del;
  const { error } = await supabase.from('task_shares').insert({
    owner_id: me,
    audience_type: audience.type,
    audience_space_id: audience.type === 'space' ? audience.id : null,
    audience_profile_id: audience.type === 'profile' ? audience.id : null,
    level,
  });
  if (error) throw error;
}

export async function deleteTaskShare(id: string): Promise<void> {
  const { error } = await supabase.from('task_shares').delete().eq('id', id);
  if (error) throw error;
}

// ─── The viewer's side ───────────────────────────────────────────────────────

export interface VisibleTasks {
  owner_name: string;
  todos: { id: string; title: string }[];
  reminders: { id: string; title: string; start_date: string; end_date: string; at_min: number | null; recurrence: Recurrence | null }[];
}

/** Someone's open list, if their rules admit you — null means they keep
 *  their tasks private (or no such member). */
export async function visibleTasksOf(ownerId: string): Promise<VisibleTasks | null> {
  const { data, error } = await supabase.rpc('visible_tasks_of', { p_owner: ownerId });
  if (error) { console.warn('visible_tasks_of:', error.message); return null; }
  return (data as VisibleTasks | null) ?? null;
}
