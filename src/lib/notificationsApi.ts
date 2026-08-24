import { supabase } from './supabase';
import type { Scope } from './sections';

export interface NotificationRow {
  id: string;
  recipient_id: string;
  section: string;
  space_id: string | null;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  actor_id: string | null;
  read_at: string | null;
  created_at: string;
}

/** Space-stewarding chatter (someone knocking, sharing, proposing). These stay
 *  OUT of the main bell — they live on the space's Manage page instead
 *  (founder 2026-07-27: admin notifications on the public pages are
 *  distracting; the backend is where admins tend the space). */
export const ADMIN_DESK_TYPES = new Set([
  'space_join_request', 'space_member_suggested', 'group_nesting_request', 'section_share_request',
]);
export const isDeskRow = (r: NotificationRow) => ADMIN_DESK_TYPES.has(r.type);

export const NOTIFICATION_COLS =
  'id, recipient_id, section, space_id, type, title, body, link, actor_id, read_at, created_at';

/** Recent notifications for a member (read + unread; the panel styles unread). */
export async function loadNotifications(me: string): Promise<NotificationRow[]> {
  const { data } = await supabase
    .from('notifications')
    .select(NOTIFICATION_COLS)
    .eq('recipient_id', me)
    .order('created_at', { ascending: false })
    .limit(200);
  return (data as NotificationRow[] | null) ?? [];
}

export async function markNotificationRead(id: string): Promise<void> {
  await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', id);
}

/** Mark every unread notification in a scope read (global / section / space). */
export async function markScopeReadRemote(me: string, scope: Scope): Promise<void> {
  const now = new Date().toISOString();
  let q = supabase.from('notifications').update({ read_at: now })
    .eq('recipient_id', me).is('read_at', null);
  // A section holds ALL its rows, space-stamped or not (2026-08-24: chat
  // bells for a space's rooms carry the space so badges can follow the hat,
  // but a "via the space" message is still yours — /chat must clear it).
  if (scope.kind === 'section') q = q.eq('section', scope.section);
  else if (scope.kind === 'space') q = q.eq('space_id', scope.spaceId);
  await q;
}

// ─── Scope selectors (shared by the provider + panel) ────────────────────────
export function rowsForScope(rows: NotificationRow[], scope: Scope): NotificationRow[] {
  if (scope.kind === 'global') return rows;
  if (scope.kind === 'space') return rows.filter((r) => r.space_id === scope.spaceId);
  return rows.filter((r) => r.section === scope.section);
}
export function isUnreadInScope(r: NotificationRow, scope: Scope): boolean {
  return !r.read_at && rowsForScope([r], scope).length > 0;
}
