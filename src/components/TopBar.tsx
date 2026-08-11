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
import PresencePrompt from './PresencePrompt';
import { clearPromptCache } from '../lib/promptsApi';
import Avatar from './Avatar';
import { useTopIdentity } from '../lib/topIdentity';
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
  { prefix: '/mycelium',    label: 'My-celium',   custom: true          },
  { prefix: '/communities', label: 'Communities', icon: 'user-multiple' },
  { prefix: '/community',   label: 'Communities', icon: 'user-multiple' },
  { prefix: '/groups',      label: 'Groups',      icon: 'user-multiple' },
  { prefix: '/organizations', label: 'Organizations', icon: 'globe'     },
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
  { prefix: '/travel',      label: 'Travel',      icon: 'plane'         },
  { prefix: '/donate',      label: 'Give',        icon: 'heart-line'    },
];

// (Concierge's settings gear removed 2026-07-17 — it only opened /profile,
// which the avatar chip already does everywhere.)

const SPACE_KINDS = ['organization', 'community', 'group', 'place'];

export default function TopBar({
  onMenu,
}: TopBarProps) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const section = SECTION_LOGOS.find((s) => pathname.startsWith(s.prefix));

  const { unreadForScope } = useNotifications();
  const { actor, setActor, options, beings, self } = useActing();
  const { user } = useAuth();
  const selfId = user?.id ?? 'me';
  const scope = scopeForPath(pathname);
  const notificationCount = unreadForScope(scope);
  const [panelOpen, setPanelOpen] = useState(false);
  const [switchOpen, setSwitchOpen] = useState(false);
  // The candle — a persistent "I'm present, open to connecting" toggle you can
  // light/snuff from anywhere. No fade: it stays until you unclick it.
  const [candleOn, setCandleOn] = useState<boolean | null>(null);
  // The bubble anchors to the real button, so it has to be an element in
  // state — a plain ref wouldn't re-render the prompt when it mounts.
  const [candleEl, setCandleEl] = useState<HTMLButtonElement | null>(null);
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
    clearPromptCache();   // the next member reads their own history, not yours
    await supabase.auth.signOut();
    navigate('/login', { replace: true });
  }

  /** Pick an identity: act as it, and stay exactly where you were (founder
   *  2026-08-10) — you switched from this page for a reason; pages that
   *  care who's acting (Profile's own redirect, Calendar's default
   *  calendar) react to the actor change themselves, so the switcher
   *  doesn't need to force navigation on top of that. */
  function pickIdentity(target: 'self' | (typeof options)[number] | (typeof beings)[number]) {
    if (target === 'self') {
      setActor({ type: 'self' });
    } else if ('kind' in target && !SPACE_KINDS.includes(target.kind)) {
      setActor({ type: 'being', id: target.id, name: target.name, kind: target.kind });
    } else {
      setActor({ type: 'space', ...(target as (typeof options)[number]) });
    }
    setSwitchOpen(false);
  }

  const ident = useTopIdentity();
  // Identity pages (own/member/space profile) skip the logo slot entirely —
  // the page's own big avatar IS the identity, so a small duplicate circle
  // up here only wasted a gap between it and the real content (founder
  // 2026-08-03, extending the earlier /profile-only rule to every profile
  // kind). The bar itself shrinks to match, so the page content actually
  // moves up instead of leaving that space empty.
  const compact = !!ident || section?.prefix === '/profile';

  return (
    <header className={'top-bar' + (compact ? ' top-bar--compact' : '')}>
      <div className="top-bar__left">
        <button
          className="top-bar__icon"
          onClick={onMenu}
          aria-label="Open menu"
        >
          <Icon name="menu" size={20} />
        </button>
        {/* Back-to-Home beside the hamburger on section screens (founder
            2026-07-25): same circle, same size — one tap returns to Home. */}
        {section && section.prefix !== '/profile' && (
          <button
            className="top-bar__icon"
            onClick={() => navigate('/home')}
            aria-label="Back to Home"
            title="Back to Home"
          >
            <Icon name="arrow-left" size={18} />
          </button>
        )}
      </div>

      <div className="top-bar__logo">
        {ident ? (
          null
        ) : section ? (
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
          className={'top-bar__acting' + (actor.type !== 'self' ? ' is-entity' : '')}
          onClick={() => (user ? setSwitchOpen((o) => !o)
            : navigate(`/login?next=${encodeURIComponent(window.location.pathname)}`))}
          title={!user ? 'Sign in' : actor.type !== 'self' ? `Acting as ${actor.name} — tap to switch` : 'Acting as yourself — tap to switch'}
          aria-label={!user ? 'Sign in' : actor.type !== 'self' ? `Acting as ${actor.name}. Open profile switcher.` : 'Acting as yourself. Open profile switcher.'}
        >
          {actor.type !== 'self' ? (
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
              {beings.map((b) => (
                <button
                  key={b.id}
                  className={'top-bar__switch-row' + (actor.type === 'being' && actor.id === b.id ? ' is-on' : '')}
                  onClick={() => pickIdentity(b)}
                  role="menuitem"
                >
                  <span className="top-bar__switch-avatar" style={{ background: colorFor(b.id) }}>
                    {monogramFor(b.name)}
                  </span>
                  <span className="top-bar__switch-name">{b.name}</span>
                  <span className="top-bar__switch-kind">{b.kind}</span>
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
            ref={setCandleEl}
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

      {/* The bubble can change the light too — keep the button in step. */}
      <PresencePrompt anchor={candleEl} onChange={setCandleOn} />

      {panelOpen && <NotificationPanel scope={scope} onClose={() => setPanelOpen(false)} />}
    </header>
  );
}
