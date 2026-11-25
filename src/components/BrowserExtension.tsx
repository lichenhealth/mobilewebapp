import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  EXTENSION_ZIP, connectExtension, detectExtension, listExtensionTokens, revokeExtensionToken,
  type ExtensionPresence, type ExtensionToken,
} from '../lib/extensionApi';

/** Profile → Connections → the browser extension card (founder 2026-11-25:
 *  "if someone is purchasing something at a store and you have a coupon,
 *  alert them… lets do the browser extension"). */
const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

export default function BrowserExtension() {
  const [here, setHere] = useState<ExtensionPresence | null>(null);
  const [tokens, setTokens] = useState<ExtensionToken[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [arm, setArm] = useState<string | null>(null);
  const [steps, setSteps] = useState(false);

  const load = async () => {
    const [p, t] = await Promise.all([detectExtension(), listExtensionTokens()]);
    setHere(p); setTokens(t);
  };
  useEffect(() => {
    void load();
    const again = () => { if (document.visibilityState === 'visible') void load(); };
    document.addEventListener('visibilitychange', again);
    return () => document.removeEventListener('visibilitychange', again);
  }, []);

  async function connect() {
    setBusy(true); setErr(''); setOk('');
    try { await connectExtension(); setOk('Connected ✓ — your coupons are in this browser now.'); await load(); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  async function revoke(id: string) {
    if (arm !== id) { setArm(id); return; }
    await revokeExtensionToken(id); setArm(null); await load();
  }

  const status = here?.connected ? 'Connected in this browser ✓' : here?.installed ? 'Installed — not connected yet' : 'Not installed in this browser';

  return (
    <div className="conn__card" id="extension">
      <div className="conn__head">
        <strong>Browser extension — coupons</strong>
        <span className={'conn__status' + (here?.connected ? ' is-on' : '')}>{here ? status : ''}</span>
      </div>
      <p className="conn__fine">
        When you shop on a store's website and you hold a <Link className="link-cue" to="/currentcy#coupons">Lichen coupon</Link> for it,
        the Lichen icon lights up with the code — and at checkout it pops up a reminder. It only downloads your coupon list; which sites you visit never leaves your browser.
        Works in Chrome, Edge and Brave on a computer.
      </p>

      {here?.installed ? (
        <div className="conn__acts">
          <button className="conn__btn" disabled={busy} onClick={() => void connect()}>
            {busy ? 'Connecting…' : here.connected ? 'Connect again' : 'Connect this browser'}
          </button>
        </div>
      ) : (
        <>
          <div className="conn__acts">
            <a className="conn__btn" href={EXTENSION_ZIP} download>Download the extension</a>
            <button className="conn__btn conn__btn--quiet" onClick={() => setSteps((v) => !v)}>{steps ? 'Hide the steps' : 'How to install'}</button>
          </div>
          {steps && (
            <ol className="conn__fine conn__steps">
              <li>Unzip <b>lichen-coupons.zip</b> (double-click it).</li>
              <li>Open <b>chrome://extensions</b> in the address bar (Edge: edge://extensions).</li>
              <li>Turn on <b>Developer mode</b> (top right), click <b>Load unpacked</b>, and pick the unzipped folder.</li>
              <li>Come back here and press <b>Connect this browser</b> — it appears once Lichen sees the extension.</li>
            </ol>
          )}
          <p className="conn__fine">It's not in the Chrome Web Store yet, so it installs this way for now.</p>
        </>
      )}
      {ok && <p className="conn__fine conn__ok">{ok}</p>}
      {err && <p className="conn__err">{err}</p>}

      {tokens.length > 0 && (
        <ul className="conn__nums">
          {tokens.map((t) => (
            <li key={t.id} className="conn__num">
              <span>{t.label || 'A browser'} · connected {day(t.created_at)}{t.last_used_at ? ` · last checked ${day(t.last_used_at)}` : ''}</span>
              <button className={'conn__btn conn__btn--quiet' + (arm === t.id ? ' is-armed' : '')} onClick={() => void revoke(t.id)}>
                {arm === t.id ? 'Disconnect it?' : 'Disconnect'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
