import { Fragment, useEffect, useState } from 'react';
import { useNavigate, NavLink } from 'react-router-dom';
import { Icon, IconName } from './Icon';
import { MyceliumMark } from './MyceliumMark';
import { listMyMemberSpaces, listMyAdminDeskCounts, type MappableSpace, type AdminDesk } from '../lib/spacesApi';
import { useAuth } from '../auth/AuthProvider';
import { useNotifications } from '../notifications/NotificationsProvider';
import { sectionForRoute } from '../lib/sections';
import { useAdminView } from '../lib/adminView';
import { supabase } from '../lib/supabase';
import { getIdentityTags } from '../lib/meansApi';
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
  /** The kind's mark — the same icon its directory, pins and tabs wear
   *  (founder 2026-08-21: "add in all the icons for consistency"). */
  icon: IconName;
  items: SubItem[];
  defaultExpanded: boolean;
}

/** THE TWO FEEDS, AT THE TOP (founder 2026-08-08: "rename home as Lichen,
 *  then put My-celium directly under it, so you can quickly go from everyone
 *  to just your web"). Same feed, two scopes — the whole platform, then the
 *  people you've woven in. Everything else is a tool or a place; these two are
 *  where you read. My-celium wears the mycelium mark rather than an Icon glyph,
 *  so the nav entry and the section's own identity are the same drawing. */
const LEAD: { to: string; label: string; icon: IconName }[] = [
  { to: '/home',      label: 'Lichen',    icon: 'home' },
  { to: '/mycelium',  label: 'My-celium', icon: 'sparkle' },   // icon overridden below
];

const PRIMARY: { to: string; label: string; icon: IconName }[] = [
  { to: '/concierge', label: 'Concierge', icon: 'concierge' },
  { to: '/chat',      label: 'Chat',      icon: 'chat' },
  { to: '/calendar',  label: 'Calendar',  icon: 'calendar' },
  { to: '/events',    label: 'Events',    icon: 'rsvp' },
  { to: '/drive',     label: 'Drive',     icon: 'drive' },
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
const MOBILE_HIDDEN = new Set(['/home', '/concierge', '/chat', '/calendar', '/drive', '/maps', '/profile', '/events']);
const hideOnMobile = (to: string) => MOBILE_HIDDEN.has(to) || to.startsWith('/members/');

/** The four space sections' sub-items are the member's REAL memberships,
 *  fetched when the menu opens. My-celium left this list (founder 2026-08-08)
 *  — it's a FEED, so it belongs beside Lichen at the top, not among the
 *  places you belong to. */
const SPACE_SECTIONS: { key: string; title: string; href: string; kind: MappableSpace['kind']; icon: IconName }[] = [
  { key: 'communities', title: 'Communities', href: '/communities', kind: 'community', icon: 'user-multiple' },
  { key: 'groups', title: 'Groups', href: '/groups', kind: 'group', icon: 'groups' },
  { key: 'organizations', title: 'Organizations', href: '/organizations', kind: 'organization', icon: 'globe' },
  { key: 'places', title: 'Places', href: '/places', kind: 'place', icon: 'location' },
];
const SECTIONS: NavSection[] = SPACE_SECTIONS.map((s) =>
  ({ key: s.key, title: s.title, href: s.href, icon: s.icon, items: [], defaultExpanded: false }));

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
  // Admin view (founder 2026-07-27): the space lists flip from engagement
  // (peach unreads) to stewardship — only the spaces you manage, blue badges
  // counting what waits at each desk, taps landing backstage. Blue = tending
  // the structure; peach = life inside it. The TOGGLE itself moved onto the
  // page in 2026-08-08 (AdminViewToggle, where a space's own Member|Admin pair
  // sits); the menu only reads the flag now.
  const adminView = useAdminView();
  const [desk, setDesk] = useState<AdminDesk>({ ids: new Set(), counts: {} });
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(SECTIONS.map((s) => [s.key, s.defaultExpanded]))
  );
  const [mySpaces, setMySpaces] = useState<MappableSpace[]>([]);
  // Identities you carry (founder 2026-08-20): a nav section of their own —
  // structurally different from communities (nobody runs an identity), but
  // reached the same way. Sub-items are YOUR identities; the header opens
  // the whole directory. Hidden in admin view — there is nothing to steward.
  const [idnExpanded, setIdnExpanded] = useState(false);
  const [myIdentities, setMyIdentities] = useState<{ id: string; name: string }[]>([]);
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

  useEffect(() => {
    if (!user) return;
    let live = true;
    void (async () => {
      const [tags, { data: cats }] = await Promise.all([
        getIdentityTags(user.id),
        supabase.from('categories').select('id, name').eq('domain', 'identity'),
      ]);
      if (!live) return;
      const mine = new Set(tags.map((t) => t.trim().toLowerCase()));
      setMyIdentities(((cats as { id: string; name: string }[] | null) ?? [])
        .filter((c) => mine.has(c.name.trim().toLowerCase()))
        .sort((a, b) => a.name.localeCompare(b.name)));
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

  // Lichen + My-celium; the web feed steps aside in admin view.
  const lead = adminView ? LEAD.filter((p) => p.to !== '/mycelium') : LEAD;

  /** One row of the nav — used by both the lead pair and the tools below. */
  const navItem = (p: { to: string; label: string; icon: IconName }) => {
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
          {p.to === '/mycelium'
            ? <MyceliumMark size={20} label="" />
            : <Icon name={p.icon} size={20} />}
          <span>{p.label}</span>
          {count > 0 && <span className="nav-badge side-menu__badge">{count > 9 ? '9+' : count}</span>}
        </NavLink>
      </Fragment>
    );
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
          {/* THE TWO FEEDS lead the nav: everyone, then your web. In admin
              view My-celium steps aside — that mode is about the spaces you
              steward, not what you're reading. */}
          <div className="side-menu__primary">
            {lead.map(navItem)}
          </div>

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
            if (adminView && items.length === 0) return null;
            return (
              <div key={s.key} className="side-menu__section">
                <button
                  className="side-menu__header"
                  onClick={() => toggleAndGo(s)}
                  aria-expanded={expanded[s.key]}
                >
                  <Icon name={s.icon} size={20} />
                  <span className="side-menu__header-label">{s.title}</span>
                  {/* A shut list must not hide what waits at its desks
                      (2026-08-20, when admin view stopped auto-opening):
                      the header carries the kind's summed count until the
                      list is open and the per-space badges take over. */}
                  {!expanded[s.key] && (() => {
                    const sum = items.reduce((n, it) => n + it.count, 0);
                    return sum > 0
                      ? <span className={'side-menu__deskbadge' + (adminView ? '' : ' side-menu__deskbadge--peach')}>{sum > 9 ? '9+' : sum}</span>
                      : null;
                  })()}
                  {items.length > 0 && (
                    <span
                      className={
                        'side-menu__chevron' +
                        // The arrow tells the truth about the list below it.
                        // Admin view used to hold every list open; shut by
                        // default since 2026-08-20 (founder) — both views
                        // open on tap now.
                        (expanded[s.key] ? ' is-open' : '')
                      }
                      aria-hidden="true"
                    />
                  )}
                </button>
                {expanded[s.key] && items.length > 0 && (
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

          {/* Identities ride below the spaces you belong to — same reach,
              different nature (founder 2026-08-20: an identity holds any
              number of people and nobody runs it). Absent in admin view. */}
          {!adminView && (
            <div className="side-menu__section">
              {/* Identities sit IN LINE with the other section titles, a
                  hairline above them as the visual split (founder 2026-08-21)
                  — same icon grid as everything else, different nature. */}
              <div className="side-menu__divider" aria-hidden />
              <button
                className="side-menu__header"
                onClick={() => { setIdnExpanded((e) => !e); go('/identities'); }}
                aria-expanded={idnExpanded}
              >
                <Icon name="fingerprint" size={20} />
                <span className="side-menu__header-label">Identities</span>
                {myIdentities.length > 0 && (
                  <span className={'side-menu__chevron' + (idnExpanded ? ' is-open' : '')} aria-hidden="true" />
                )}
              </button>
              {idnExpanded && myIdentities.length > 0 && (
                <ul className="side-menu__sub-list">
                  {myIdentities.map((c) => (
                    <li key={c.id}>
                      <button className="side-menu__sub-item" onClick={() => go(`/identities/${c.id}`)}>
                        {c.name}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* The tools and platform doors come AFTER the places you belong to
              (founder 2026-08-08): what you read and where you belong lead;
              Concierge, Chat, Calendar and the rest follow. */}
          <div className="side-menu__primary side-menu__primary--tools">
            {primary.map(navItem)}
          </div>

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
