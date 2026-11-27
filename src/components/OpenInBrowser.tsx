import { useState } from 'react';
import './OpenInBrowser.css';
import { openInBrowser, type HandoffBrowser } from '../lib/browserHandoff';

/** The one door to Safari for voice on an iPhone (2026-11-26; Chrome's
 *  button retired 2026-11-27 — iPhone Chrome can't listen, so Lichen picks
 *  Safari for the person) — signed in, on the same screen, voice on. */
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
      </div>
      {err && <p className="oib__lead">{err}</p>}
    </div>
  );
}
