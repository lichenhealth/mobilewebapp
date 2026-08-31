import { createContext, useContext, useEffect, useMemo, useState, ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthProvider';
import { useActing } from '../acting/ActingProvider';
import type { Scope } from '../lib/sections';
import {
  NotificationRow, loadNotifications, markNotificationRead, markScopeReadRemote, rowsForScope,
  isDeskRow,
} from '../lib/notificationsApi';

interface NotificationsState {
  rows: NotificationRow[];
  countsBySection: Record<string, number>;
  countsBySpace: Record<string, number>;
  totalUnread: number;
  unreadForScope: (scope: Scope) => number;
  rowsForScope: (scope: Scope) => NotificationRow[];
  markRead: (id: string) => void;
  markScopeRead: (scope: Scope) => void;
  /** Admin-desk rows for one space — surfaced on its Manage page, not the bell. */
  deskRowsForSpace: (spaceId: string) => NotificationRow[];
}

const NotificationsContext = createContext<NotificationsState>({
  rows: [], countsBySection: {}, countsBySpace: {}, totalUnread: 0,
  unreadForScope: () => 0, rowsForScope: () => [], markRead: () => {}, markScopeRead: () => {},
  deskRowsForSpace: () => [],
});

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const me = user?.id ?? '';
  // NOTIFICATIONS FOLLOW THE HAT (founder 2026-08-24): every badge the app
  // shows derives from this provider, so filtering here swaps the desktop
  // sidebar, the bottom nav, the hamburger, and the bell's section counts
  // together. Acting as a space, only rows stamped with THAT space count;
  // as yourself, every row addressed to you counts (space-stamped rows are
  // still yours — a message "via the space" sits in your inbox too).
  // ⚠ Wait for `ready` (the acting-as rule): until the persisted hat has
  // restored, the actor reads as the boot default "self" — counting under it
  // would flash the person's numbers at someone wearing a space.
  const { actor, ready: actingReady } = useActing();
  const actingSpace = actor.type === 'space' ? actor.id : null;
  const [rows, setRows] = useState<NotificationRow[]>([]);

  // Initial load + realtime subscription, keyed on the signed-in user.
  useEffect(() => {
    if (!me) { setRows([]); return; }
    let active = true;
    const resync = () => { loadNotifications(me).then((r) => { if (active) setRows(r); }); };
    resync();
    const channel = supabase
      .channel(`notifications:${me}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'notifications', filter: `recipient_id=eq.${me}` },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            const row = payload.new as NotificationRow;
            setRows((cur) => (cur.some((r) => r.id === row.id) ? cur : [row, ...cur]));
          } else if (payload.eventType === 'UPDATE') {
            const row = payload.new as NotificationRow;
            setRows((cur) => cur.map((r) => (r.id === row.id ? row : r)));
          } else if (payload.eventType === 'DELETE') {
            const old = payload.old as { id: string };
            setRows((cur) => cur.filter((r) => r.id !== old.id));
          }
        })
      // Realtime never replays what the socket missed while suspended
      // (backgrounded tab, iOS PWA backgrounding, sleep/wake, a network
      // blip) — resync on every (re)connect so a dropped connection can't
      // leave the bell stuck on stale state until something else nudges it.
      .subscribe((status) => { if (status === 'SUBSCRIBED') resync(); });
    // Belt-and-suspenders: some browsers suspend a backgrounded tab's socket
    // without cleanly signaling a reconnect. Catch up whenever the tab is
    // looked at again, regardless of what the channel reports.
    const onVisible = () => { if (document.visibilityState === 'visible') resync(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      active = false;
      document.removeEventListener('visibilitychange', onVisible);
      supabase.removeChannel(channel);
    };
  }, [me]);

  const { countsBySection, countsBySpace, totalUnread } = useMemo(() => {
    const sec: Record<string, number> = {};
    const spc: Record<string, number> = {};
    let total = 0;
    for (const r of rows) {
      if (r.read_at || isDeskRow(r)) continue;
      // Per-space buckets stay actor-independent — a space PAGE's scope
      // reads them whoever you're wearing.
      if (r.space_id) spc[r.space_id] = (spc[r.space_id] ?? 0) + 1;
      // The hat decides what the badges count: the acting space's rows, or
      // (as yourself) everything addressed to you, each in its section.
      // Not ready yet = badge silence, never the wrong identity's numbers.
      if (!actingReady) continue;
      if (actingSpace ? r.space_id === actingSpace : true) {
        total += 1;
        sec[r.section] = (sec[r.section] ?? 0) + 1;
      }
    }
    return { countsBySection: sec, countsBySpace: spc, totalUnread: total };
  }, [rows, actingSpace, actingReady]);

  const unreadForScope = (scope: Scope) => {
    if (scope.kind === 'global') return totalUnread;
    if (scope.kind === 'space') return countsBySpace[scope.spaceId] ?? 0;
    return countsBySection[scope.section] ?? 0;
  };

  const markRead = (id: string) => {
    setRows((cur) => cur.map((r) => (r.id === id && !r.read_at ? { ...r, read_at: new Date().toISOString() } : r)));
    void markNotificationRead(id);
  };
  const markScopeRead = (scope: Scope) => {
    const now = new Date().toISOString();
    setRows((cur) => cur.map((r) =>
      !r.read_at && rowsForScope([r], scope).length ? { ...r, read_at: now } : r));
    void markScopeReadRemote(me, scope);
  };

  const value: NotificationsState = {
    rows, countsBySection, countsBySpace, totalUnread, unreadForScope,
    rowsForScope: (scope) => rowsForScope(rows, scope).filter((r) => !isDeskRow(r)),
    markRead, markScopeRead,
    deskRowsForSpace: (spaceId) => rows.filter((r) => r.space_id === spaceId && isDeskRow(r)),
  };
  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}

export function useNotifications() { return useContext(NotificationsContext); }
