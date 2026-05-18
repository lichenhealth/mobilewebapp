import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from './Icon';
import { COMMUNITIES, GROUPS, NETWORK_LABELS } from '../data/network';
import './SideMenu.css';

interface SideMenuProps {
  open: boolean;
  onClose: () => void;
}

interface SubItem {
  label: string;
  href: string;
}

interface NavSection {
  key: string;
  title: string;
  href: string;
  items: SubItem[];
  defaultExpanded: boolean;
}

const SECTIONS: NavSection[] = [
  {
    key: 'mycelium',
    title: 'Mycelium',
    href: '/mycelium',
    items: (Object.keys(NETWORK_LABELS) as Array<keyof typeof NETWORK_LABELS>).map(
      (type) => ({
        label: NETWORK_LABELS[type],
        href: `/mycelium/${type === 'person' ? 'people' : type === 'place' ? 'places' : `${type}s`}`,
      })
    ),
    defaultExpanded: true,
  },
  {
    key: 'communities',
    title: 'Communities',
    href: '/communities',
    items: COMMUNITIES.map((c) => ({ label: c.name, href: `/communities/${c.id}` })),
    defaultExpanded: true,
  },
  {
    key: 'groups',
    title: 'Groups',
    href: '/groups',
    items: GROUPS.map((g) => ({ label: g.name, href: `/groups/${g.id}` })),
    defaultExpanded: false,
  },
  {
    key: 'marketplace',
    title: 'Marketplace',
    href: '/market',
    items: [
      { label: 'Goods',    href: '/market/goods'    },
      { label: 'Services', href: '/market/services' },
      { label: 'Spaces',   href: '/market/spaces'   },
      { label: 'ISO',      href: '/market/iso'      },
    ],
    defaultExpanded: false,
  },
];

export default function SideMenu({ open, onClose }: SideMenuProps) {
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(SECTIONS.map((s) => [s.key, s.defaultExpanded]))
  );

  // Lock body scroll + close on Escape
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

  const go = (href: string) => {
    navigate(href);
    onClose();
  };

  const toggleAndGo = (section: NavSection) => {
    setExpanded((e) => ({ ...e, [section.key]: !e[section.key] }));
    go(section.href);
  };

  return (
    <div className={'side-menu' + (open ? ' is-open' : '')} aria-hidden={!open}>
      <div className="side-menu__scrim" onClick={onClose} />
      <aside className="side-menu__panel" role="dialog" aria-label="Navigation">
        <button
          className="side-menu__close"
          onClick={onClose}
          aria-label="Close menu"
        >
          <Icon name="close" size={18} />
        </button>

        <nav className="side-menu__nav">
          {SECTIONS.map((s) => (
            <div key={s.key} className="side-menu__section">
              <button
                className="side-menu__header"
                onClick={() => toggleAndGo(s)}
                aria-expanded={expanded[s.key]}
              >
                <span className="side-menu__header-label">{s.title}</span>
                <span
                  className={
                    'side-menu__chevron' +
                    (expanded[s.key] ? ' is-open' : '')
                  }
                  aria-hidden="true"
                />
              </button>
              {expanded[s.key] && s.items.length > 0 && (
                <ul className="side-menu__sub-list">
                  {s.items.map((item) => (
                    <li key={item.href}>
                      <button
                        className="side-menu__sub-item"
                        onClick={() => go(item.href)}
                      >
                        {item.label}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}

          <div className="side-menu__section">
            <button
              className="side-menu__donate"
              onClick={() => go('/donate')}
            >
              Donate
            </button>
          </div>
        </nav>
      </aside>
    </div>
  );
}
