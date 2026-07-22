import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Icon, IconName } from './Icon';
import { LichenMark } from './LichenMark';
import { MyceliumMark } from './MyceliumMark';
import { useNotifications } from '../notifications/NotificationsProvider';
import { useActing } from '../acting/ActingProvider';
import { useAuth } from '../auth/AuthProvider';
import { supabase } from '../lib/supabase';
import { colorFor, monogramFor } from '../lib/chatApi';
import { myPresence, setAlwaysPresent } from '../lib/presenceApi';
import Avatar from './Avatar';
import { scopeForPath } from '../lib/sections';
import NotificationPanel from '../notifications/NotificationPanel';
import './TopBar.css';

interface TopBarProps {
  onMenu?: () => void;
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
  { prefix: '/courses',     label: 'Courses',     icon: 'graduation-cap' },
  { prefix: '/saved',       label: 'Saved',       icon: 'bookmark'      },
  { prefix: '/maps',        label: 'Maps',        icon: 'globe'         },
  { prefix: '/events',      label: 'Events',      icon: 'rsvp'          },
  { prefix: '/profile',     label: 'Profile',     icon: 'profile'       },
  { prefix: '/work',        label: 'Work',        icon: 'briefcase'     },
  { prefix: '/events',      label: 'Events',      icon: 'sparkle'       },
  { prefix: '/library',     label: 'Library',     icon: 'book'          },
  { prefix: '/art',         label: 'Art',         icon: 'palette'       },
  { prefix: '/food',        label: 'Food',        icon: 'fork-spoon'    },
  { prefix: '/places',      label: 'Places',      icon: 'location'      },
  { prefix: '/donate',      label: 'Give',        icon: 'heart-line'    },
];

// (Concierge's settings gear removed 2026-07-17 — it only opened /profile,
// which the avatar chip already does everywhere.)

export default function TopBar({
  onMenu,
}: TopBarProps) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const section = SECTION_LOGOS.find((s) => pathname.startsWith(s.prefix));

  const { unreadForScope } = useNotifications();
  const { actor, setActor, options, self } = useActing();
  const { user } = useAuth();
  const selfId = user?.id ?? 'me';
  const scope = scopeForPath(pathname);
  const notificationCount = unreadForScope(scope);
  const [panelOpen, setPanelOpen] = useState(false);
  const [switchOpen, setSwitchOpen] = useState(false);
  // The candle — a persistent "I'm present, open to connecting" toggle you can
  // light/snuff from anywhere. No fade: it stays until you unclick it.
  const [candleOn, setCandleOn] = useState<boolean | null>(null);
  useEffect(() => {
    if (!user) { setCandleOn(null); return; }
    let live = true;
    void myPresence(user.id).then((p) => { if (live) setCandleOn(p ? p.alwaysPresent : null); });
    return () => { live = false; };
  }, [user]);
  const toggleCandle = () => {
    if (!user || candleOn === null) return;
    const next = !candleOn;
    setCandleOn(next);
    void setAlwaysPresent(user.id, next).catch(() => setCandleOn(!next));
  };

  async function signOut() {
    setSwitchOpen(false);
    await supabase.auth.signOut();
    navigate('/login', { replace: true });
  }

  /** Pick an identity: act as it AND land on its profile. */
  function pickIdentity(target: 'self' | (typeof options)[number]) {
    if (target === 'self') {
      setActor({ type: 'self' });
      navigate('/profile');
    } else {
      setActor({ type: 'space', ...target });
      navigate(`/spaces/${target.id}`);
    }
    setSwitchOpen(false);
  }

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
          section.prefix === '/profile' ? (
            /* No section mark on Profile — the page's own photo IS the identity;
               a duplicate circle above it just pushed content down. */
            null
          ) : section.custom && section.prefix === '/mycelium' ? (
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
          <div className="top-bar__home-logo"><LichenMark size={56} /><span className="top-bar__wordmark">Lichen</span></div>
        )}
      </div>

      <div className="top-bar__right">
        <div className="top-bar__switch-wrap">
        <button
          className={'top-bar__acting' + (actor.type === 'space' ? ' is-entity' : '')}
          onClick={() => (user ? setSwitchOpen((o) => !o)
            : navigate(`/login?next=${encodeURIComponent(window.location.pathname)}`))}
          title={!user ? 'Sign in' : actor.type === 'space' ? `Acting as ${actor.name} — tap to switch` : 'Acting as yourself — tap to switch'}
          aria-label={!user ? 'Sign in' : actor.type === 'space' ? `Acting as ${actor.name}. Open profile switcher.` : 'Acting as yourself. Open profile switcher.'}
        >
          {actor.type === 'space' ? (
            <span className="top-bar__acting-avatar" style={{ background: colorFor(actor.id) }}>
              {monogramFor(actor.name)}
            </span>
          ) : (
            <Avatar id={selfId} name={self.name} url={self.avatarUrl} size={36} />
          )}
        </button>
        {switchOpen && (
          <>
            <div className="top-bar__switch-scrim" onClick={() => setSwitchOpen(false)} />
            <div className="top-bar__switch" role="menu" aria-label="Switch profile">
              <button
                className={'top-bar__switch-row' + (actor.type === 'self' ? ' is-on' : '')}
                onClick={() => pickIdentity('self')}
                role="menuitem"
              >
                <Avatar id={selfId} name={self.name} url={self.avatarUrl} size={30} />
                <span className="top-bar__switch-name">{self.name || 'You'}</span>
                <span className="top-bar__switch-kind">You</span>
              </button>
              {options.map((o) => (
                <button
                  key={o.id}
                  className={'top-bar__switch-row' + (actor.type === 'space' && actor.id === o.id ? ' is-on' : '')}
                  onClick={() => pickIdentity(o)}
                  role="menuitem"
                >
                  <span className="top-bar__switch-avatar" style={{ background: colorFor(o.id) }}>
                    {monogramFor(o.name)}
                  </span>
                  <span className="top-bar__switch-name">{o.name}</span>
                  <span className="top-bar__switch-kind">{o.kind}</span>
                </button>
              ))}
              <button className="top-bar__switch-row top-bar__switch-signout" onClick={signOut} role="menuitem">
                <span className="top-bar__switch-name">Sign out</span>
              </button>
            </div>
          </>
        )}
        </div>
        {candleOn !== null && (
          <button
            className={'top-bar__icon top-bar__candle' + (candleOn ? ' is-lit' : '')}
            onClick={toggleCandle}
            aria-pressed={candleOn}
            title={candleOn ? 'Present — open to connecting. Tap to snuff.' : 'Light your candle — show you’re present'}
            aria-label={candleOn ? 'Snuff your presence candle' : 'Light your presence candle'}
          >
            <span aria-hidden="true">🕯️</span>
          </button>
        )}
        <button
          className="top-bar__icon top-bar__bell"
          onClick={() => setPanelOpen((o) => !o)}
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

      {panelOpen && <NotificationPanel scope={scope} onClose={() => setPanelOpen(false)} />}
    </header>
  );
}
