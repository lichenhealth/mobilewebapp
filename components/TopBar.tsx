import { Icon } from './Icon';
import { LichenMark } from './LichenMark';
import './TopBar.css';

interface TopBarProps {
  notificationCount?: number;
  onMenu?: () => void;
  onNotifications?: () => void;
}

export default function TopBar({
  notificationCount = 12,
  onMenu,
  onNotifications,
}: TopBarProps) {
  return (
    <header className="top-bar">
      <button
        className="top-bar__icon"
        onClick={onMenu}
        aria-label="Open menu"
      >
        <Icon name="menu" size={20} />
      </button>

      <div className="top-bar__logo">
        <LichenMark size={48} />
      </div>

      <button
        className="top-bar__icon top-bar__bell"
        onClick={onNotifications}
        aria-label={`Notifications (${notificationCount})`}
      >
        <Icon name="bell" size={18} />
        {notificationCount > 0 && (
          <span className="top-bar__badge">
            {notificationCount > 99 ? '99+' : notificationCount}
          </span>
        )}
      </button>
    </header>
  );
}
