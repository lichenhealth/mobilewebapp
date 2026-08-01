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

// THE PHONE CTA (founder 2026-07-31): members browsing on a phone get a
// walkthrough to plant Lichen on their home screen. Honesty about limits:
// the browser cannot DETECT an installed iOS app, nor jump into it — home-
// screen apps live in their own world. So the choice we can truly offer is
// "show me how" / "already added it — I'll open it from my home screen" /
// "keep using the web" (which rests the prompt for a month). Running INSIDE
// the installed app (standalone) renders nothing, ever.
export default function InstallPrompt() {
  const { user } = useAuth();
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);
  const [sheet, setSheet] = useState(false);

  const standalone = typeof window !== 'undefined' && (
    window.matchMedia?.('(display-mode: standalone)').matches
    || (navigator as unknown as { standalone?: boolean }).standalone === true
  );
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const isIOS = /iphone|ipad|ipod/i.test(ua);
  const isMobile = isIOS || /android/i.test(ua);

  // Android path: the native install prompt, when the browser offers it.
  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  // Show for signed-in members on a phone browser (never in the installed app).
  useEffect(() => {
    if (!user || standalone || !isMobile) return;
    const until = Number(localStorage.getItem(DISMISS_KEY) ?? 0);
    if (until && Date.now() < until) return;
    const t = setTimeout(() => setVisible(true), 4_000);
    return () => clearTimeout(t);
  }, [user, standalone, isMobile]);

  if (!visible || !user || standalone || !isMobile) return null;

  const rest = (days: number) => {
    localStorage.setItem(DISMISS_KEY, String(Date.now() + days * 24 * 60 * 60 * 1000));
    setVisible(false); setSheet(false);
  };

  const onInstall = async () => {
    if (deferred) {
      await deferred.prompt();
      const { outcome } = await deferred.userChoice;
      if (outcome === 'accepted') { rest(365); return; }
      setDeferred(null);
      return;
    }
    setSheet(true);   // no native prompt (iOS, or Android without the event) → walkthrough
  };

  return (
    <>
      <div className="install-prompt" role="dialog" aria-labelledby="install-title">
        <div className="install-prompt__mark" aria-hidden="true">
          <Icon name="install" size={18} />
        </div>
        <div className="install-prompt__body">
          <p id="install-title" className="install-prompt__title">
            Put Lichen on your phone
          </p>
          <p className="install-prompt__sub">
            Full screen, lock-screen reminders, one tap from home.
          </p>
        </div>
        <div className="install-prompt__actions">
          <button className="btn btn-ink" onClick={onInstall}>
            {deferred ? 'Install' : 'Show me how'}
          </button>
          <button className="install-prompt__dismiss" onClick={() => rest(30)} aria-label="Keep using the web">
            <Icon name="close" size={14} />
          </button>
        </div>
      </div>

      {sheet && (
        <div className="install-sheet" role="dialog" aria-label="Add Lichen to your home screen">
          <div className="install-sheet__card">
            <p className="install-sheet__title">Add Lichen to your home screen</p>
            {isIOS ? (
              <ol className="install-sheet__steps">
                <li>Tap the <strong>Share</strong> button <span className="install-sheet__glyph">⎋</span> at the bottom of Safari</li>
                <li>Scroll and choose <strong>Add to Home Screen</strong></li>
                <li>Open <strong>Lichen</strong> from your home screen and sign in once</li>
                <li>For reminders on your lock screen: Profile → Notifications → <strong>On this device</strong></li>
              </ol>
            ) : (
              <ol className="install-sheet__steps">
                <li>Tap the <strong>⋮</strong> menu in your browser</li>
                <li>Choose <strong>Add to Home screen</strong> (or <strong>Install app</strong>)</li>
                <li>Open <strong>Lichen</strong> from your home screen and sign in once</li>
              </ol>
            )}
            <p className="install-sheet__already">
              Already added it? Open it from your home screen icon — the browser
              can&rsquo;t switch over for you. Nothing here is lost either way.
            </p>
            <div className="install-sheet__acts">
              <button className="btn btn-primary" onClick={() => rest(365)}>Done — I added it</button>
              <button className="btn" onClick={() => rest(30)}>I&rsquo;ll keep using the web</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
