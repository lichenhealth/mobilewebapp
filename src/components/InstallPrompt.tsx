import { useEffect, useState } from 'react';
import { Icon } from './Icon';
import { useAuth } from '../auth/AuthProvider';
import './InstallPrompt.css';

// Type for the beforeinstallprompt event (not yet in lib.dom)
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISS_KEY = 'lichen.install.dismissed.until';

/** Open the install walkthrough from anywhere (the side menu's door). */
export function openInstallGuide() {
  window.dispatchEvent(new Event('lichen:install'));
}

// THE INSTALL DOOR — phones AND computers (founder 2026-07-31 for phones;
// widened 2026-11-16: "install lichen on my computer like it is on my phone,
// so I don't have to go to a browser all the time"). Honesty about limits:
// the browser can't DETECT an installed app or jump into it, so the choice
// we can truly offer is "show me how" / "already added it" / "keep using the
// web" (which rests the card). Inside the installed app, nothing renders.

type Platform = 'ios' | 'android' | 'mac-safari' | 'chrome' | 'edge' | 'firefox' | 'other';

function detect(): Platform {
  if (typeof navigator === 'undefined') return 'other';
  const ua = navigator.userAgent;
  const iPadDesktop = /Macintosh/.test(ua) && (navigator.maxTouchPoints ?? 0) > 1;
  if (/iphone|ipad|ipod/i.test(ua) || iPadDesktop) return 'ios';
  if (/android/i.test(ua)) return 'android';
  if (/Edg\//.test(ua)) return 'edge';
  if (/Firefox\//.test(ua)) return 'firefox';
  if (/Chrome\/|CriOS|Chromium/.test(ua)) return 'chrome';
  if (/Macintosh/.test(ua) && /Safari\//.test(ua)) return 'mac-safari';
  return 'other';
}

function isStandalone() {
  return typeof window !== 'undefined' && (
    window.matchMedia?.('(display-mode: standalone)').matches
    || (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

// One captured native prompt for the whole app (card and sheet share it).
let deferredPrompt: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e as BeforeInstallPromptEvent;
    listeners.forEach((f) => f());
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    try { localStorage.setItem(DISMISS_KEY, String(Date.now() + 365 * 864e5)); } catch { /* */ }
    listeners.forEach((f) => f());
  });
}
function useDeferred() {
  const [, bump] = useState(0);
  useEffect(() => {
    const f = () => bump((n) => n + 1);
    listeners.add(f);
    return () => { listeners.delete(f); };
  }, []);
  return deferredPrompt;
}

function rest(days: number) {
  try { localStorage.setItem(DISMISS_KEY, String(Date.now() + days * 864e5)); } catch { /* */ }
}

/** The card in Home's flow. */
export default function InstallPrompt() {
  const { user } = useAuth();
  const deferred = useDeferred();
  const [visible, setVisible] = useState(false);
  const platform = detect();
  const standalone = isStandalone();
  const phone = platform === 'ios' || platform === 'android';

  useEffect(() => {
    if (!user || standalone) return;
    let until = 0;
    try { until = Number(localStorage.getItem(DISMISS_KEY) ?? 0); } catch { /* */ }
    if (until && Date.now() < until) return;
    const t = setTimeout(() => setVisible(true), 4_000);
    return () => clearTimeout(t);
  }, [user, standalone]);

  if (!visible || !user || standalone) return null;

  const onInstall = async () => {
    if (deferred) {
      await deferred.prompt();
      const { outcome } = await deferred.userChoice;
      deferredPrompt = null;
      if (outcome === 'accepted') { rest(365); setVisible(false); }
      return;
    }
    openInstallGuide();
  };

  return (
    <div className="install-prompt" role="dialog" aria-labelledby="install-title">
      <div className="install-prompt__mark" aria-hidden="true">
        <Icon name="install" size={18} />
      </div>
      <div className="install-prompt__body">
        <p id="install-title" className="install-prompt__title">
          {phone ? 'Put Lichen on your phone' : 'Put Lichen on this computer'}
        </p>
        <p className="install-prompt__sub">
          {phone
            ? 'Full screen, lock-screen reminders, one tap from home.'
            : 'Its own window, no browser tabs — open it from your Dock or Start menu.'}
        </p>
      </div>
      <div className="install-prompt__actions">
        <button className="btn btn-ink" onClick={onInstall}>
          {deferred ? 'Install' : 'Show me how'}
        </button>
        <button className="install-prompt__dismiss" onClick={() => { rest(7); setVisible(false); }} aria-label="Keep using the web">
          <Icon name="close" size={14} />
        </button>
      </div>
    </div>
  );
}

/** The walkthrough sheet — mounted once app-wide, opened by openInstallGuide(). */
export function InstallGuide() {
  const [open, setOpen] = useState(false);
  const [which, setWhich] = useState<Platform>(detect());
  const deferred = useDeferred();
  useEffect(() => {
    const f = () => { setWhich(detect()); setOpen(true); };
    window.addEventListener('lichen:install', f);
    return () => window.removeEventListener('lichen:install', f);
  }, []);
  if (!open) return null;

  const close = (days?: number) => { if (days) rest(days); setOpen(false); };
  const desktop = !(which === 'ios' || which === 'android');
  const installed = isStandalone();

  const nativeInstall = async () => {
    if (!deferred) return;
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;
    deferredPrompt = null;
    if (outcome === 'accepted') close(365);
  };

  const after = desktop ? (
    <>
      <li>Open <strong>Lichen</strong> from {which === 'mac-safari'
        ? 'your Dock or Launchpad'
        : which === 'edge'
          ? 'the Start menu or taskbar'
          : 'your Dock or Launchpad (Mac) or the Start menu (Windows)'} — sign in once</li>
      <li>For alerts on this computer: Profile → Notifications → <strong>On this device</strong></li>
    </>
  ) : (
    <>
      <li>Open <strong>Lichen</strong> from your home screen and sign in once</li>
      <li>For reminders on your lock screen: Profile → Notifications → <strong>On this device</strong></li>
    </>
  );

  const steps: Record<Platform, JSX.Element> = {
    ios: (
      <ol className="install-sheet__steps">
        <li>Open lichen.health in <strong>Safari</strong></li>
        <li>Tap the <strong>Share</strong> button <span className="install-sheet__glyph">⎋</span> (bottom of the screen on iPhone, top on iPad)</li>
        <li>Scroll and choose <strong>Add to Home Screen</strong>, then <strong>Add</strong></li>
        {after}
      </ol>
    ),
    android: (
      <ol className="install-sheet__steps">
        <li>Open lichen.health in <strong>Chrome</strong></li>
        <li>Tap the <strong>⋮</strong> menu, top right</li>
        <li>Choose <strong>Install app</strong> (or <strong>Add to Home screen</strong>)</li>
        {after}
      </ol>
    ),
    'mac-safari': (
      <ol className="install-sheet__steps">
        <li>In Safari, open the <strong>File</strong> menu (top of the screen)</li>
        <li>Choose <strong>Add to Dock…</strong>, then <strong>Add</strong> <span className="install-sheet__note">(needs macOS Sonoma or newer)</span></li>
        {after}
      </ol>
    ),
    chrome: (
      <ol className="install-sheet__steps">
        <li>Look for the <strong>install icon</strong> (a little screen with a down arrow) at the right end of Chrome's address bar, and click it</li>
        <li>No icon? Click Chrome's <strong>⋮</strong> menu → <strong>Cast, save and share</strong> → <strong>Install page as app…</strong></li>
        <li>Click <strong>Install</strong></li>
        {after}
      </ol>
    ),
    edge: (
      <ol className="install-sheet__steps">
        <li>Click the <strong>install icon</strong> at the right end of Edge's address bar</li>
        <li>No icon? Click Edge's <strong>⋯</strong> menu → <strong>Apps</strong> → <strong>Install this site as an app</strong></li>
        <li>Click <strong>Install</strong></li>
        {after}
      </ol>
    ),
    firefox: (
      <ol className="install-sheet__steps">
        <li>Firefox on a computer can't install web apps. Open <strong>lichen.health</strong> in <strong>Chrome</strong> or <strong>Edge</strong> (or <strong>Safari</strong> on a Mac)</li>
        <li>Then follow that browser's steps — pick it below</li>
      </ol>
    ),
    other: (
      <ol className="install-sheet__steps">
        <li>Open <strong>lichen.health</strong> in Chrome, Edge, or Safari (Mac/iPhone)</li>
        <li>Then follow that browser's steps — pick it below</li>
      </ol>
    ),
  };

  const PICK: { id: Platform; label: string }[] = [
    { id: 'ios', label: 'iPhone / iPad' },
    { id: 'android', label: 'Android' },
    { id: 'mac-safari', label: 'Mac · Safari' },
    { id: 'chrome', label: 'Chrome (Mac / Windows)' },
    { id: 'edge', label: 'Edge (Windows)' },
  ];

  return (
    <div className="install-sheet" role="dialog" aria-label="Install Lichen" onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="install-sheet__card">
        <button className="install-sheet__x" onClick={() => close()} aria-label="Close"><Icon name="close" size={14} /></button>
        <p className="install-sheet__title">{desktop ? 'Install Lichen on this computer' : 'Add Lichen to your home screen'}</p>
        {installed && <p className="install-sheet__already">You're already in the installed app on this device. ✓ To put it on another device, pick it below.</p>}
        {deferred && !installed && (
          <p className="install-sheet__oneclick">
            <button className="btn btn-primary" onClick={nativeInstall}>Install Lichen now</button>
            <span>Your browser can do it in one click.</span>
          </p>
        )}
        <div className="install-sheet__picks" role="tablist" aria-label="Which device or browser">
          {PICK.map((p) => (
            <button key={p.id} role="tab" aria-selected={which === p.id}
              className={'install-sheet__pick' + (which === p.id ? ' is-on' : '')}
              onClick={() => setWhich(p.id)}>{p.label}</button>
          ))}
        </div>
        {steps[which]}
        <p className="install-sheet__already">
          It's the same Lichen — same account, same everything — just in its own
          window. The browser can't switch over for you, so once it's installed,
          open it from its icon.
        </p>
        <div className="install-sheet__acts">
          <button className="btn btn-primary" onClick={() => close(365)}>Done — I installed it</button>
          <button className="btn" onClick={() => close(7)}>I'll keep using the browser</button>
        </div>
      </div>
    </div>
  );
}
