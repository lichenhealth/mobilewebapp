import { useEffect, useState } from 'react';
import { Icon } from './Icon';
import './InstallPrompt.css';

// Type for the beforeinstallprompt event (not yet in lib.dom)
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISS_KEY = 'lichen.install.dismissed.until';

export default function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Don't show if dismissed recently
    const until = Number(localStorage.getItem(DISMISS_KEY) ?? 0);
    if (until && Date.now() < until) return;

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
      // Show after a small delay so it doesn't feel intrusive
      setTimeout(() => setVisible(true), 4_000);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  if (!visible || !deferred) return null;

  const onInstall = async () => {
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;
    if (outcome === 'accepted') setVisible(false);
    setDeferred(null);
  };

  const onDismiss = () => {
    // Hide for a week
    localStorage.setItem(DISMISS_KEY, String(Date.now() + 7 * 24 * 60 * 60 * 1000));
    setVisible(false);
  };

  return (
    <div className="install-prompt" role="dialog" aria-labelledby="install-title">
      <div className="install-prompt__mark" aria-hidden="true">
        <Icon name="install" size={18} />
      </div>
      <div className="install-prompt__body">
        <p id="install-title" className="install-prompt__title">
          Plant Lichen on your home screen
        </p>
        <p className="install-prompt__sub">
          A quiet place to return to. No notifications you didn't ask for.
        </p>
      </div>
      <div className="install-prompt__actions">
        <button className="btn btn-ink" onClick={onInstall}>Install</button>
        <button
          className="install-prompt__dismiss"
          onClick={onDismiss}
          aria-label="Dismiss"
        >
          <Icon name="close" size={14} />
        </button>
      </div>
    </div>
  );
}
