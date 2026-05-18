import { useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import { Icon, IconName } from './Icon';
import { LichenMark } from './LichenMark';
import './SideMenu.css';

interface SideMenuProps {
  open: boolean;
  onClose: () => void;
}

interface Section {
  to: string;
  label: string;
  icon: IconName;
  blurb: string;
  status?: 'live' | 'soon' | 'quiet';
}

const SECTIONS: Section[] = [
  { to: '/home',      label: 'Home',      icon: 'home',           blurb: 'Today, in the network',     status: 'live'  },
  { to: '/community', label: 'Community', icon: 'profile',        blurb: 'Mons Sana — your circle', status: 'live'  },
  { to: '/concierge', label: 'Concierge', icon: 'concierge',      blurb: 'Three picks, slow',          status: 'live'  },
  { to: '/chat',      label: 'Chat',      icon: 'chat',           blurb: 'Conversations & groups',     status: 'live'  },
  { to: '/calendar',  label: 'Calendar',  icon: 'calendar',       blurb: 'Suppers, swaps, workshops', status: 'soon'  },
  { to: '/saved',     label: 'Saved',     icon: 'saved',          blurb: 'Things to come back to',     status: 'soon'  },
  { to: '/maps',      label: 'Maps',      icon: 'maps',           blurb: 'A bioregional view',         status: 'soon'  },
  { to: '/profile',   label: 'Profile',   icon: 'profile',        blurb: 'The you that lives here',    status: 'soon'  },
];

const PASSAGES: Section[] = [
  { to: '/places',   label: 'Places',   icon: 'location',       blurb: 'Spaces members open up'      },
  { to: '/market',   label: 'Market',   icon: 'store',          blurb: 'Local goods, fair prices'    },
  { to: '/work',     label: 'Work',     icon: 'briefcase',      blurb: 'Help wanted, help offered'   },
  { to: '/events',   label: 'Events',   icon: 'sparkle',        blurb: 'In-person, mostly'           },
  { to: '/library',  label: 'Library',  icon: 'book',           blurb: 'Essays, field guides, zines' },
  { to: '/groups',   label: 'Groups',   icon: 'graduation-cap', blurb: 'Smaller circles'             },
  { to: '/mycelium', label: 'Mycelium', icon: 'sparkle',        blurb: 'The underlayer'              },
];

export default function SideMenu({ open, onClose }: SideMenuProps) {
  // Lock body scroll while open + close on Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = '';
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  return (
    <div className={'side-menu' + (open ? ' is-open' : '')} aria-hidden={!open}>
      <div className="side-menu__scrim" onClick={onClose} />
      <aside className="side-menu__panel" role="dialog" aria-label="Navigation">
        <header className="side-menu__head">
          <LichenMark size={52} />
          <button
            className="side-menu__close"
            onClick={onClose}
            aria-label="Close menu"
          >
            <Icon name="close" size={18} />
          </button>
        </header>

        <div className="side-menu__section-label">Primary</div>
        <nav className="side-menu__list">
          {SECTIONS.map((s) => (
            <NavLink
              key={s.to}
              to={s.to}
              onClick={onClose}
              className={({ isActive }) =>
                'side-menu__item' + (isActive ? ' is-active' : '')
              }
            >
              <span className="side-menu__icon">
                <Icon name={s.icon} size={16} />
              </span>
              <span className="side-menu__text">
                <span className="side-menu__label">{s.label}</span>
                <span className="side-menu__blurb">{s.blurb}</span>
              </span>
              {s.status === 'soon' && (
                <span className="side-menu__status">soon</span>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="side-menu__divider" />

        <div className="side-menu__section-label">Passages</div>
        <nav className="side-menu__list">
          {PASSAGES.map((s) => (
            <NavLink
              key={s.to}
              to={s.to}
              onClick={onClose}
              className={({ isActive }) =>
                'side-menu__item' + (isActive ? ' is-active' : '')
              }
            >
              <span className="side-menu__icon">
                <Icon name={s.icon} size={16} />
              </span>
              <span className="side-menu__text">
                <span className="side-menu__label">{s.label}</span>
                <span className="side-menu__blurb">{s.blurb}</span>
              </span>
              <span className="side-menu__status">soon</span>
            </NavLink>
          ))}
        </nav>

        <footer className="side-menu__foot">
          <p className="side-menu__foot-text">
            <span className="display-italic">Lichen</span> grows where two things help
            each other live. Pass two builds the rest of the rooms.
          </p>
        </footer>
      </aside>
    </div>
  );
}
