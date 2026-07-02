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
  const { rowsForScope, unreadForScope, markRead, markScopeRead } = useNotifications();
  const rows = rowsForScope(scope);
  const unread = unreadForScope(scope);

  const open = (n: NotificationRow) => {
    if (!n.read_at) markRead(n.id);
    onClose();
    if (n.link) navigate(n.link);
  };

  return (
    <>
      <div className="notif-scrim" onClick={onClose} />
      <div className="notif-panel" role="dialog" aria-label="Notifications">
        <div className="notif-panel__head">
          <span className="notif-panel__title">{scopeLabel(scope)}</span>
          {unread > 0 && (
            <button className="notif-panel__mark" onClick={() => markScopeRead(scope)}>Mark all read</button>
          )}
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
              className={'notif-row' + (n.read_at ? '' : ' is-unread')}
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
              {!n.read_at && <span className="notif-row__dot" aria-hidden="true" />}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
