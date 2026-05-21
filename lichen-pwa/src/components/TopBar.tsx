import { useLocation, useNavigate } from 'react-router-dom';
import { Icon, IconName } from './Icon';
import { LichenMark } from './LichenMark';
import { MyceliumMark } from './MyceliumMark';
import './TopBar.css';

interface TopBarProps {
  notificationCount?: number;
  onMenu?: () => void;
  onNotifications?: () => void;
}

/** Section identity: when on these route prefixes, show a section-specific
 *  logo instead of the Lichen wordmark. Order matters — first match wins,
 *  so more specific prefixes go first. */
interface SectionLogo {
  prefix: string;
  label: string;
  /** Either an icon name (rendered inside the standard black-filled circle)
   *  or `custom` (rendered directly — for branded marks like Mycelium). */
  icon?: IconName;
  custom?: boolean;
}

const SECTION_LOGOS: SectionLogo[] = [
  { prefix: '/market',      label: 'Marketplace', icon: 'store'         },
  { prefix: '/mycelium',    label: 'Mycelium',    custom: true          },
  { prefix: '/communities', label: 'Communities', icon: 'user-multiple' },
  { prefix: '/community',   label: 'Communities', icon: 'user-multiple' },
  { prefix: '/groups',      label: 'Groups',      icon: 'user-multiple' },
  { prefix: '/concierge',   label: 'Concierge',   icon: 'concierge'     },
  { prefix: '/chat',        label: 'Chat',        icon: 'chat'          },
  { prefix: '/calendar',    label: 'Calendar',    icon: 'calendar'      },
  { prefix: '/saved',       label: 'Saved',       icon: 'bookmark'      },
  { prefix: '/maps',        label: 'Maps',        icon: 'globe'         },
  { prefix: '/profile',     label: 'Profile',     icon: 'profile'       },
  { prefix: '/work',        label: 'Work',        icon: 'briefcase'     },
  { prefix: '/events',      label: 'Events',      icon: 'sparkle'       },
  { prefix: '/library',     label: 'Library',     icon: 'book'          },
  { prefix: '/places',      label: 'Places',      icon: 'location'      },
  { prefix: '/donate',      label: 'Donate',      icon: 'heart-line'    },
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
          section.custom && section.prefix === '/mycelium' ? (
            <div
              className="top-bar__section-mark top-bar__section-mark--custom"
              role="img"
              aria-label={section.label}
              title={section.label}
            >
              <MyceliumMark size={68} />
            </div>
          ) : (
            <div
              className="top-bar__section-mark"
              role="img"
              aria-label={section.label}
              title={section.label}
            >
              <Icon name={section.icon!} size={34} />
            </div>
          )
        ) : (
          <LichenMark size={68} />
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
