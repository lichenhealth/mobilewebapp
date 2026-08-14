import { NavLink } from 'react-router-dom';
import { Icon, IconName } from './Icon';
import { useNotifications } from '../notifications/NotificationsProvider';
import { sectionForRoute } from '../lib/sections';
import './BottomNav.css';

interface NavItem {
  to: string;
  label: string;
  icon: IconName;
}

const ITEMS: NavItem[] = [
  // "Lichen" not "Home" (founder 2026-08-08): the front door is the whole
  // platform's feed, and My-celium beside it is the same feed narrowed to your
  // web. Naming it Lichen makes that pair legible.
  { to: '/home',      label: 'LICHEN',    icon: 'home' },
  { to: '/concierge', label: 'CONCIERGE', icon: 'concierge' },
  { to: '/chat',      label: 'CHAT',      icon: 'chat' },
  { to: '/calendar',  label: 'CALENDAR',  icon: 'calendar' },
  { to: '/drive',     label: 'DRIVE',     icon: 'drive' },
  { to: '/maps',      label: 'MAPS',      icon: 'maps' },
  { to: '/profile',   label: 'PROFILE',   icon: 'profile' },
];

export default function BottomNav() {
  const { countsBySection, totalUnread } = useNotifications();
  const countFor = (to: string) =>
    to === '/home' ? totalUnread : (countsBySection[sectionForRoute(to) ?? ''] ?? 0);

  return (
    <nav className="bottom-nav" aria-label="Primary">
      <ul className="bottom-nav__list">
        {ITEMS.map((item) => {
          const count = countFor(item.to);
          return (
            <li key={item.to}>
              <NavLink
                to={item.to}
                className={({ isActive }) =>
                  'bottom-nav__item' + (isActive ? ' is-active' : '')
                }
              >
                <span className="bottom-nav__icon">
                  <Icon name={item.icon} size={20} />
                  {count > 0 && <span className="nav-badge">{count > 9 ? '9+' : count}</span>}
                </span>
                <span className="bottom-nav__label">{item.label}</span>
              </NavLink>
            </li>
          );
        })}
      </ul>
      <div className="bottom-nav__indicator" aria-hidden="true" />
    </nav>
  );
}
