import { useState } from 'react';
import './OpenInBrowser.css';
import { openInBrowser, type HandoffBrowser } from '../lib/browserHandoff';

/** The one door from the iPhone home-screen app to Safari/Chrome for voice
 *  (2026-11-26) — signed in, on the same screen, voice switched on. */
export default function OpenInBrowser({ to, flags, lead }: { to?: string; flags?: Record<string, string>; lead?: string }) {
  const [busy, setBusy] = useState<HandoffBrowser | null>(null);
  const [err, setErr] = useState('');
  const go = async (b: HandoffBrowser) => {
    setBusy(b); setErr('');
    try { await openInBrowser(b, to ?? window.location.pathname + window.location.search, flags); }
    catch (e) { setErr(e instanceof Error ? e.message : 'That didn’t open.'); }
    finally { window.setTimeout(() => setBusy(null), 2000); }
  };
  return (
    <div className="oib">
      {lead && <p className="oib__lead">{lead}</p>}
      <div className="oib__btns">
        <button type="button" className="oib__btn" onClick={() => void go('safari')} disabled={!!busy}>{busy === 'safari' ? 'Opening…' : 'Open in Safari ›'}</button>
        <button type="button" className="oib__btn" onClick={() => void go('chrome')} disabled={!!busy}>{busy === 'chrome' ? 'Opening…' : 'Open in Chrome ›'}</button>
      </div>
      {err && <p className="oib__lead">{err}</p>}
    </div>
  );
}
