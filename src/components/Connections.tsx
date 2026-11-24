// PROFILE → CONNECTIONS (founder 2026-11-24: "how can we make this more
// seamless and easy for non technical lichen users and their other
// services"). One place for every outside service a member's Brain can work
// with, and every watch the Brain is keeping for them. Content-only — Profile
// supplies the CollapsibleSection chrome.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { listMailAccounts, type MailAccount } from '../lib/mailApi';
import {
  connectTwilio, disconnectService, listConnections, listWatches, stopWatch, twilioStatus,
  type AssistantWatch, type ServiceConnection, type TwilioNumber,
} from '../lib/connectionsApi';
import './Connections.css';

const idField = { autoCapitalize: 'none', autoCorrect: 'off', spellCheck: false } as const;

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function Connections() {
  const [conns, setConns] = useState<ServiceConnection[] | null>(null);
  const [inboxes, setInboxes] = useState<MailAccount[]>([]);
  const [numbers, setNumbers] = useState<TwilioNumber[] | null>(null);
  const [watches, setWatches] = useState<AssistantWatch[]>([]);
  const [open, setOpen] = useState(false);
  const [acct, setAcct] = useState('');
  const [keySid, setKeySid] = useState('');
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [arm, setArm] = useState(false);

  const twilio = conns?.find((c) => c.service === 'twilio') ?? null;

  const load = async () => {
    const [c, w, m] = await Promise.all([listConnections(), listWatches(), listMailAccounts().catch(() => [])]);
    setConns(c); setWatches(w); setInboxes(m);
    if (c.some((x) => x.service === 'twilio')) {
      twilioStatus().then((s) => setNumbers(s.numbers ?? [])).catch(() => setNumbers(null));
    }
  };
  useEffect(() => { void load(); }, []);

  async function connect() {
    setBusy(true); setErr('');
    try {
      const r = await connectTwilio(acct, keySid, secret);
      setNumbers(r.numbers); setAcct(''); setKeySid(''); setSecret(''); setOpen(false);
      await load();
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  }

  async function disconnect() {
    if (!arm) { setArm(true); return; }
    setBusy(true);
    try { await disconnectService('twilio'); setNumbers(null); setArm(false); await load(); }
    catch (e) { setErr((e as Error).message); }
    setBusy(false);
  }

  return (
    <div className="conn">
      <p className="prof__care-lead">
        Services your Brain can work with for you. Connect one here once, then just ask in any conversation.
      </p>

      <div className="conn__card">
        <div className="conn__head">
          <strong>Email</strong>
          <span className={'conn__status' + (inboxes.length ? ' is-on' : '')}>
            {inboxes.length ? `${inboxes.length} inbox${inboxes.length === 1 ? '' : 'es'} connected` : 'Not connected'}
          </span>
        </div>
        {inboxes.length > 0 && <p className="conn__fine">{inboxes.map((i) => i.email).join(' · ')}</p>}
        <Link className="link-cue conn__door" to="/mail">Manage in Mail ›</Link>
      </div>

      <div className="conn__card">
        <div className="conn__head">
          <strong>Twilio</strong>
          <span className={'conn__status' + (twilio && twilio.status === 'connected' ? ' is-on' : twilio ? ' is-err' : '')}>
            {twilio ? (twilio.status === 'connected' ? 'Connected ✓' : 'Needs attention') : 'Not connected'}
          </span>
        </div>
        {twilio ? (
          <>
            <p className="conn__fine">{twilio.label}{twilio.last_error ? ` — ${twilio.last_error}` : ''}</p>
            {numbers && (
              <p className="conn__fine">
                {numbers.length ? `Numbers on this account: ${numbers.map((n) => n.number).join(', ')}` : 'No phone numbers on this account yet.'}
              </p>
            )}
            <div className="conn__acts">
              <button className={'conn__btn conn__btn--quiet' + (arm ? ' is-armed' : '')} disabled={busy} onClick={() => void disconnect()}>
                {arm ? 'Disconnect for good?' : 'Disconnect'}
              </button>
              {arm && <button className="conn__btn conn__btn--quiet" onClick={() => setArm(false)}>Keep it</button>}
            </div>
          </>
        ) : !open ? (
          <>
            <p className="conn__fine">Phone numbers and texting. Your Brain can check your numbers and tell you the moment a transferred number arrives.</p>
            <button className="conn__btn" onClick={() => setOpen(true)}>Connect Twilio</button>
          </>
        ) : (
          <div className="conn__form">
            <p className="conn__fine">
              In <a className="link-cue" href="https://console.twilio.com/" target="_blank" rel="noreferrer">your Twilio console</a>, copy your Account SID
              from the home page, then under Account → API keys &amp; tokens create a Standard API key and copy its SID and secret.
            </p>
            <label className="conn__label">Account SID
              <input className="conn__input" {...idField} value={acct} onChange={(e) => setAcct(e.target.value)} placeholder="AC…" />
            </label>
            <label className="conn__label">API key SID
              <input className="conn__input" {...idField} value={keySid} onChange={(e) => setKeySid(e.target.value)} placeholder="SK…" />
            </label>
            <label className="conn__label">API key secret
              <input className="conn__input" type="password" autoComplete="off" {...idField} value={secret} onChange={(e) => setSecret(e.target.value)} />
            </label>
            <p className="conn__fine">Lichen checks the key with Twilio, keeps it locked to your account, and never shows it again. You can delete the key in Twilio any time.</p>
            <div className="conn__acts">
              <button className="conn__btn" disabled={busy || !acct || !keySid || !secret} onClick={() => void connect()}>{busy ? 'Checking…' : 'Connect'}</button>
              <button className="conn__btn conn__btn--quiet" onClick={() => { setOpen(false); setErr(''); }}>Cancel</button>
            </div>
          </div>
        )}
      </div>

      <h3 className="conn__h">What your Brain is watching for</h3>
      {watches.length === 0 ? (
        <p className="conn__fine">Nothing yet. Tell your Brain something like “let me know when Twilio confirms my number transfer” and it will keep watch, checking every 10 minutes.</p>
      ) : (
        <ul className="conn__watches">
          {watches.map((w) => (
            <li key={w.id} className={'conn__watch' + (w.status === 'fired' ? ' is-fired' : '')}>
              <div className="conn__watch-main">
                <strong>{w.label}</strong>
                <span className="conn__fine">
                  {w.status === 'fired'
                    ? <>Came true {w.fired_at ? shortDate(w.fired_at) : ''}{w.convo_id && <> · <Link className="link-cue" to={`/assistant/feed?thread=general&convo=${w.convo_id}`}>See the note</Link></>}</>
                    : <>{w.kind === 'mail' ? 'Watching your email' : 'Watching your Twilio numbers'} · until {shortDate(w.expires_at)}</>}
                </span>
                {w.then_note && <span className="conn__fine">Then: {w.then_note}</span>}
              </div>
              {w.status === 'active' && (
                <button className="conn__btn conn__btn--quiet" onClick={() => void stopWatch(w.id).then(load)}>Stop</button>
              )}
            </li>
          ))}
        </ul>
      )}
      {err && <p className="conn__err">{err}</p>}
    </div>
  );
}
