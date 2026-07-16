import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { colorFor, monogramFor, formatRelative } from '../lib/chatApi';
import type { Scope } from '../lib/sections';
import { useNotifications } from './NotificationsProvider';
import type { NotificationRow } from '../lib/notificationsApi';
import './NotificationPanel.css';

function scopeLabel(scope: Scope): string {
  if (scope.kind === 'global') return 'All notifications';
  if (scope.kind === 'space') return 'This space';
  const s = scope.section;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export default function NotificationPanel({ scope, onClose }: { scope: Scope; onClose: () => void }) {
  const navigate = useNavigate();
  const { rowsForScope, markScopeRead } = useNotifications();
  const rows = rowsForScope(scope);

  // Opening the panel counts as reading (founder, 2026-07-15): the badge
  // clears immediately, no row-by-row clicking. We snapshot which rows were
  // unread at open so they keep their "new" highlight while you look.
  const [freshIds] = useState(() => new Set(rows.filter((r) => !r.read_at).map((r) => r.id)));
  const marked = useRef(false);
  useEffect(() => {
    if (marked.current) return;
    marked.current = true;
    markScopeRead(scope);
    // scope is stable for the panel's lifetime (TopBar remounts it per route).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const open = (n: NotificationRow) => {
    onClose();
    if (n.link) navigate(n.link);
  };

  // A row is highlighted if it was unread at open, or arrived live since.
  const isFresh = (n: NotificationRow) => freshIds.has(n.id) || !n.read_at;

  return (
    <>
      <div className="notif-scrim" onClick={onClose} />
      <div className="notif-panel" role="dialog" aria-label="Notifications">
        <div className="notif-panel__head">
          <span className="notif-panel__title">{scopeLabel(scope)}</span>
        </div>
        <div className="notif-panel__list">
          {rows.length === 0 && (
            <div className="notif-panel__empty">
              <Icon name="bell" size={18} />
              <p>You're all caught up.</p>
            </div>
          )}
          {rows.map((n) => (
            <button
              key={n.id}
              className={'notif-row' + (isFresh(n) ? ' is-unread' : '')}
              onClick={() => open(n)}
            >
              <span className="notif-row__avatar" style={{ background: colorFor(n.actor_id ?? n.id) }}>
                {monogramFor(n.title)}
              </span>
              <span className="notif-row__body">
                <span className="notif-row__text">
                  <strong>{n.title}</strong>{n.body ? ` ${n.body}` : ''}
                </span>
                <span className="notif-row__time">{formatRelative(n.created_at)}</span>
              </span>
              {isFresh(n) && <span className="notif-row__dot" aria-hidden="true" />}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
