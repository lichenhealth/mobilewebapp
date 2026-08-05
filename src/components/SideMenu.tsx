import { Fragment, useEffect, useState } from 'react';
import { useNavigate, NavLink } from 'react-router-dom';
import { Icon, IconName } from './Icon';
import { listMyMemberSpaces, listMyAdminDeskCounts, type MappableSpace, type AdminDesk } from '../lib/spacesApi';
import { useAuth } from '../auth/AuthProvider';
import { useNotifications } from '../notifications/NotificationsProvider';
import { sectionForRoute } from '../lib/sections';
import { supabase } from '../lib/supabase';
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

const PRIMARY: { to: string; label: string; icon: IconName }[] = [
  { to: '/home',      label: 'Home',      icon: 'home' },
  { to: '/concierge', label: 'Concierge', icon: 'concierge' },
  { to: '/chat',      label: 'Chat',      icon: 'chat' },
  { to: '/calendar',  label: 'Calendar',  icon: 'calendar' },
  { to: '/events',    label: 'Events',    icon: 'rsvp' },
  { to: '/saved',     label: 'Saved',     icon: 'saved' },
  { to: '/maps',      label: 'Maps',      icon: 'maps' },
  { to: '/profile',   label: 'Profile',   icon: 'profile' },
  { to: '/invite',    label: 'Invite to Lichen', icon: 'user-multiple' },
  { to: '/help',      label: 'Help',      icon: 'info' },
  { to: '/membership', label: 'Membership', icon: 'dollar' },
];

/** The Lichen support account answers help chats — it doesn't open one with itself. */
const SUPPORT_EMAIL = 'connect@lichen.health';

/** Hidden from the MOBILE menu: bottom-nav duplicates, plus Events (lives under
 *  Calendar) and Public profile (reachable from the Profile page) — founder
 *  2026-07-24. The platform doors (Invite/Help/Membership) stay: they have no
 *  other mobile home. Desktop sidebar shows everything. */
const MOBILE_HIDDEN = new Set(['/home', '/concierge', '/chat', '/calendar', '/saved', '/maps', '/profile', '/events']);
const hideOnMobile = (to: string) => MOBILE_HIDDEN.has(to) || to.startsWith('/members/');

/** The four space sections' sub-items are the member's REAL memberships,
 *  fetched when the menu opens. Mycelium has no sub-items — its kind lenses
 *  live as chips on the feed itself (PR #72; the old sub-links duplicated
 *  them and didn't switch the lens once the feed was already open). */
const SPACE_SECTIONS: { key: string; title: string; href: string; kind: MappableSpace['kind'] }[] = [
  { key: 'communities', title: 'Communities', href: '/communities', kind: 'community' },
  { key: 'groups', title: 'Groups', href: '/groups', kind: 'group' },
  { key: 'organizations', title: 'Organizations', href: '/organizations', kind: 'organization' },
  { key: 'places', title: 'Places', href: '/places', kind: 'place' },
];
const SECTIONS: NavSection[] = [
  { key: 'mycelium', title: 'My-celium', href: '/mycelium', items: [], defaultExpanded: false },
  ...SPACE_SECTIONS.map((s) => ({ key: s.key, title: s.title, href: s.href, items: [], defaultExpanded: false })),
];

export default function SideMenu({ open, onClose }: SideMenuProps) {
  const navigate = useNavigate();
  const { user, isAdmin: platformAdmin } = useAuth();
  const primary = PRIMARY
    .filter((p) => p.to !== '/help' || user?.email?.toLowerCase() !== SUPPORT_EMAIL)
    // "Public profile" = see yourself as other members do (/members/<me>).
    // 'Public profile' retired from the nav (founder 2026-07-28): the three
    // views live as tabs INSIDE Profile — Admin · In Lichen · Web page.
    ;
  const { countsBySection, countsBySpace, totalUnread } = useNotifications();
  // Admin view (founder 2026-07-27): flip the space lists from engagement
  // (peach unreads) to stewardship — only the spaces you manage, blue badges
  // counting what waits at each desk, taps landing backstage. Blue = tending
  // the structure; peach = life inside it.
  const [adminView, setAdminView] = useState(() => localStorage.getItem('menu-admin-view') === '1');
  const [desk, setDesk] = useState<AdminDesk>({ ids: new Set(), counts: {} });
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(SECTIONS.map((s) => [s.key, s.defaultExpanded]))
  );
  const [mySpaces, setMySpaces] = useState<MappableSpace[]>([]);
  // Platform-level knock queue (founder 2026-08-02): a "Request an
  // invitation" toast disappearing shouldn't feel like the knock vanished —
  // join_requests is the permanent record (Invite.tsx "At the door"); this
  // badge just makes it impossible to lose track of an unhandled one.
  const [knockCount, setKnockCount] = useState(0);

  // Fetch memberships whenever we have a user — on DESKTOP the menu is a
  // persistent sidebar that never "opens", so this must not gate on `open`
  // (that hid everyone's communities on wide screens). `open` stays in the
  // deps so the mobile overlay refreshes each time it slides out.
  useEffect(() => {
    if (!user) return;
    let live = true;
    (async () => {
      const [rows, d] = await Promise.all([
        listMyMemberSpaces(user.id), listMyAdminDeskCounts(user.id),
      ]);
      if (live) { setMySpaces(rows); setDesk(d); }
    })();
    return () => { live = false; };
  }, [open, user]);

  // Live knock count — realtime, not just on-open, so the badge can never
  // sit stale while someone waits at the door.
  useEffect(() => {
    if (!platformAdmin) return;
    let live = true;
    const refresh = () => {
      void supabase.from('join_requests').select('id', { count: 'exact', head: true })
        .eq('status', 'new').then(({ count }) => { if (live) setKnockCount(count ?? 0); });
    };
    refresh();
    const channel = supabase.channel('join_requests:desk')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'join_requests' }, refresh)
      .subscribe();
    return () => { live = false; supabase.removeChannel(channel); };
  }, [platformAdmin]);

  const itemsFor = (key: string): { label: string; href: string; count: number; admin: boolean }[] => {
    const kind = SPACE_SECTIONS.find((s) => s.key === key)?.kind;
    if (!kind) return [];
    return mySpaces.filter((s) => s.kind === kind)
      .filter((s) => !adminView || desk.ids.has(s.id))
      .map((s) => ({
        label: s.name,
        href: adminView ? `/spaces/${s.id}?manage=1` : `/spaces/${s.id}`,
        count: adminView ? (desk.counts[s.id] ?? 0) : (countsBySpace[s.id] ?? 0),
        admin: desk.ids.has(s.id),
      }));
  };
  const deskTotal = Object.values(desk.counts).reduce((a, b) => a + b, 0) + knockCount;
  const flipAdminView = () => {
    setAdminView((v) => {
      localStorage.setItem('menu-admin-view', v ? '' : '1');
      return !v;
    });
  };

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
          {/* About button removed (founder 2026-08-04): /about is the static
              merged story on the marketing site now — "you figure it out
              before you enter the platform." */}
          <div className="side-menu__primary">
            {primary.map((p) => {
              const count = p.to === '/home'
                ? totalUnread
                : (countsBySection[sectionForRoute(p.to) ?? ''] ?? 0);
              return (
                <Fragment key={p.to}>
                {/* "you" above the line, platform doors below it */}
                {p.to === '/invite' && <div className="side-menu__divider" aria-hidden />}
                <NavLink
                  to={p.to}
                  onClick={onClose}
                  className={({ isActive }) =>
                    'side-menu__primary-item' + (isActive ? ' is-active' : '')
                    + (hideOnMobile(p.to) ? ' side-menu__primary-item--dup' : '')
                  }
                >
                  <Icon name={p.icon} size={20} />
                  <span>{p.label}</span>
                  {count > 0 && <span className="nav-badge side-menu__badge">{count > 9 ? '9+' : count}</span>}
                </NavLink>
                </Fragment>
              );
            })}
          </div>

          {(desk.ids.size > 0 || (platformAdmin && knockCount > 0)) && (
            <button
              className={'side-menu__adminview' + (adminView ? ' is-on' : '')}
              onClick={flipAdminView}
              title={adminView
                ? 'Back to the regular menu'
                : 'See the spaces you manage and what needs your attention'}
            >
              <Icon name="settings" size={15} />
              <span>Admin view</span>
              {deskTotal > 0 && <span className="side-menu__deskbadge">{deskTotal > 9 ? '9+' : deskTotal}</span>}
            </button>
          )}

          {adminView && platformAdmin && (
            <div className="side-menu__section">
              <button className="side-menu__header" aria-expanded>
                <span className="side-menu__header-label">Lichen</span>
              </button>
              <ul className="side-menu__sub-list">
                <li>
                  <button className="side-menu__sub-item" onClick={() => go('/invite')}>
                    Knocking at the door
                    {knockCount > 0 && (
                      <span className="side-menu__deskbadge">{knockCount > 9 ? '9+' : knockCount}</span>
                    )}
                  </button>
                </li>
                <li>
                  <button className="side-menu__sub-item" onClick={() => go('/admin/supporters')}>
                    Memberships &amp; gifts
                  </button>
                </li>
                <li>
                  <button className="side-menu__sub-item" onClick={() => go('/admin/categories')}>
                    Review categories
                    {(countsBySection['profile'] ?? 0) > 0 && (
                      <span className="side-menu__deskbadge">{countsBySection['profile']}</span>
                    )}
                  </button>
                </li>
              </ul>
            </div>
          )}

          {SECTIONS.map((s) => {
            const items = itemsFor(s.key);
            if (adminView && (s.key === 'mycelium' || items.length === 0)) return null;
            return (
              <div key={s.key} className="side-menu__section">
                <button
                  className="side-menu__header"
                  onClick={() => toggleAndGo(s)}
                  aria-expanded={expanded[s.key]}
                >
                  <span className="side-menu__header-label">{s.title}</span>
                  {items.length > 0 && (
                    <span
                      className={
                        'side-menu__chevron' +
                        (expanded[s.key] ? ' is-open' : '')
                      }
                      aria-hidden="true"
                    />
                  )}
                </button>
                {(expanded[s.key] || adminView) && items.length > 0 && (
                  <ul className="side-menu__sub-list">
                    {items.map((item) => (
                      <li key={item.href}>
                        <button
                          className="side-menu__sub-item"
                          onClick={() => go(item.href)}
                        >
                          {item.label}
                          {item.count > 0 && (
                            <span className={'side-menu__deskbadge' + (adminView ? '' : ' side-menu__deskbadge--peach')}>
                              {item.count > 9 ? '9+' : item.count}
                            </span>
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}

          <div className="side-menu__section">
            <button
              className="side-menu__donate"
              onClick={() => go('/donate')}
            >
              Give
            </button>
          </div>
        </nav>
      </aside>
    </div>
  );
}
