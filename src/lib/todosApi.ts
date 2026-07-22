import { supabase } from './supabase';

// ─── To-do list (founder, 2026-07-22) ───────────────────────────────────────
// Free-form checklist items — owner-only. Reminders populate the To-Do VIEW
// separately (from their own table); these are the items you add by hand.

export interface Todo {
  id: string;
  title: string;
  done: boolean;
  created_at: string;
}

const COLS = 'id, title, done, created_at';

export async function listTodos(me: string): Promise<Todo[]> {
  const { data, error } = await supabase.from('todos')
    .select(COLS).eq('profile_id', me).order('done').order('created_at', { ascending: false });
  if (error) { console.warn('listTodos:', error.message); return []; }
  return (data as Todo[] | null) ?? [];
}

export async function createTodo(me: string, title: string): Promise<Todo | null> {
  const { data, error } = await supabase.from('todos')
    .insert({ profile_id: me, title }).select(COLS).single();
  if (error) { console.warn('createTodo:', error.message); return null; }
  return data as Todo;
}

export async function setTodoDone(id: string, done: boolean): Promise<void> {
  const { error } = await supabase.from('todos').update({ done }).eq('id', id);
  if (error) throw error;
}

export async function deleteTodo(id: string): Promise<void> {
  const { error } = await supabase.from('todos').delete().eq('id', id);
  if (error) throw error;
}
