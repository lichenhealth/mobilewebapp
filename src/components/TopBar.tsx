import { useLocation, useNavigate } from 'react-router-dom';
import { Icon, IconName } from './Icon';
import { LichenMark } from './LichenMark';
import './TopBar.css';

interface TopBarProps {
  notificationCount?: number;
  onMenu?: () => void;
  onNotifications?: () => void;
}

/** Section identity: when on these route prefixes, show a section-specific
 *  icon-in-circle instead of the Lichen wordmark. */
const SECTION_LOGOS: { prefix: string; icon: IconName; label: string }[] = [
  { prefix: '/market',      icon: 'store',         label: 'Marketplace' },
  { prefix: '/mycelium',    icon: 'sparkle',       label: 'Mycelium'    },
  { prefix: '/communities', icon: 'user-multiple', label: 'Communities' },
  { prefix: '/community',   icon: 'user-multiple', label: 'Communities' },
  { prefix: '/groups',      icon: 'user-multiple', label: 'Groups'      },
  { prefix: '/concierge',   icon: 'health',        label: 'Concierge'   },
];

/** Routes that show a settings gear next to the bell */
const SETTINGS_PREFIXES = ['/concierge'];

export default function TopBar({
  notificationCount = 12,
  onMenu,
  onNotifications,
}: TopBarProps) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const section = SECTION_LOGOS.find((s) => pathname.startsWith(s.prefix));
  const showSettings = SETTINGS_PREFIXES.some((p) => pathname.startsWith(p));

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
        {section ? (
          <div
            className="top-bar__section-mark"
            role="img"
            aria-label={section.label}
            title={section.label}
          >
            <Icon name={section.icon} size={26} />
          </div>
        ) : (
          <LichenMark size={48} />
        )}
      </div>

      <div className="top-bar__right">
        {showSettings && (
          <button
            className="top-bar__icon top-bar__settings"
            onClick={() => navigate('/profile')}
            aria-label="Settings"
          >
            <Icon name="settings" size={16} />
          </button>
        )}
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
      </div>
    </header>
  );
}
