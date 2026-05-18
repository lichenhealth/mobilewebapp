import { NavLink } from 'react-router-dom';
import { Icon, IconName } from './Icon';
import './BottomNav.css';

interface NavItem {
  to: string;
  label: string;
  icon: IconName;
}

const ITEMS: NavItem[] = [
  { to: '/home',      label: 'HOME',      icon: 'home' },
  { to: '/concierge', label: 'CONCIERGE', icon: 'concierge' },
  { to: '/chat',      label: 'CHAT',      icon: 'chat' },
  { to: '/calendar',  label: 'CALENDAR',  icon: 'calendar' },
  { to: '/saved',     label: 'SAVED',     icon: 'saved' },
  { to: '/maps',      label: 'MAPS',      icon: 'maps' },
  { to: '/profile',   label: 'PROFILE',   icon: 'profile' },
];

export default function BottomNav() {
  return (
    <nav className="bottom-nav" aria-label="Primary">
      <ul className="bottom-nav__list">
        {ITEMS.map((item) => (
          <li key={item.to}>
            <NavLink
              to={item.to}
              className={({ isActive }) =>
                'bottom-nav__item' + (isActive ? ' is-active' : '')
              }
            >
              <span className="bottom-nav__icon">
                <Icon name={item.icon} size={20} />
              </span>
              <span className="bottom-nav__label">{item.label}</span>
            </NavLink>
          </li>
        ))}
      </ul>
      <div className="bottom-nav__indicator" aria-hidden="true" />
    </nav>
  );
}
