// PROFILE → CONNECTIONS (founder 2026-11-24: "how can we make this more
// seamless and easy for non technical lichen users and their other
// services"). One place for every outside service a member's Brain can work
// with, and every watch the Brain is keeping for them. Content-only — Profile
// supplies the CollapsibleSection chrome.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { connectMail, listMailAccounts, mailEnabled, type MailAccount } from '../lib/mailApi';
import {
  connectTwilio, disconnectService, listConnections, listWatches, stopWatch, twilioStatus, startImportantWatch,
  suggestConnection, listConnectionSuggestions, decideConnectionSuggestion,
  wireTwilioNumber, type AssistantWatch, type ServiceConnection, type TwilioNumber, type ConnectionSuggestion,
} from '../lib/connectionsApi';
import { useAuth } from '../auth/AuthProvider';
import { addNote, forgetNote, listNotebook, type NotebookNote } from '../lib/notebookApi';
import { Icon } from './Icon';
import BrowserExtension from './BrowserExtension';
import './Connections.css';

const idField = { autoCapitalize: 'none', autoCorrect: 'off', spellCheck: false } as const;

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

const SUGG_WORD: Record<ConnectionSuggestion['status'], string> = {
  new: 'Waiting for an answer', planned: 'Planned ✓', built: 'Ready to connect ✓', declined: 'Not for now',
};

export default function Connections() {
  const { user, isAdmin } = useAuth();
  const [adding, setAdding] = useState(false);
  const [canMail, setCanMail] = useState(false);
  const [sugName, setSugName] = useState('');
  const [sugWhy, setSugWhy] = useState('');
  const [sugSent, setSugSent] = useState('');
  const [suggs, setSuggs] = useState<ConnectionSuggestion[]>([]);
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
  const [notes, setNotes] = useState<NotebookNote[]>([]);
  const [noteText, setNoteText] = useState('');
  const [noteKind, setNoteKind] = useState<'matters' | 'quiet'>('matters');

  const twilio = conns?.find((c) => c.service === 'twilio') ?? null;

  const load = async () => {
    const [c, w, m] = await Promise.all([listConnections(), listWatches(), listMailAccounts().catch(() => [])]);
    setConns(c); setWatches(w); setInboxes(m);
    listNotebook().then(setNotes).catch(() => {});
    listConnectionSuggestions().then(setSuggs).catch(() => {});
    if (c.some((x) => x.service === 'twilio')) {
      twilioStatus().then((s) => setNumbers(s.numbers ?? [])).catch(() => setNumbers(null));
    }
  };
  useEffect(() => { void load(); }, []);

  async function wire(number: string) {
    setBusy(true); setErr('');
    try { await wireTwilioNumber(number); await load(); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  useEffect(() => { mailEnabled(user?.id).then(setCanMail).catch(() => setCanMail(false)); }, [user?.id]);

  async function suggest() {
    setBusy(true); setErr('');
    try {
      await suggestConnection(sugName, sugWhy);
      setSugSent(sugName.trim()); setSugName(''); setSugWhy('');
      listConnectionSuggestions().then(setSuggs).catch(() => {});
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  }

  async function decide(id: string, status: ConnectionSuggestion['status']) {
    try { await decideConnectionSuggestion(id, status); setSuggs((xs) => xs.map((x) => x.id === id ? { ...x, status } : x)); }
    catch (e) { setErr((e as Error).message); }
  }

  const mine = suggs.filter((x) => x.profile_id === user?.id);
  const others = isAdmin ? suggs.filter((x) => true) : [];

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
      <div className="conn__top">
        <p className="prof__care-lead">
          Services your Brain can work with for you. Connect one here once, then just ask in any conversation.
        </p>
        <button className={'conn__plus' + (adding ? ' is-on' : '')} data-tip="Connect a service" aria-label="Connect a service"
          aria-pressed={adding} onClick={() => { setAdding((v) => !v); setSugSent(''); }}>
          <Icon name="plus" size={16} />
        </button>
      </div>

      {adding && (
        <div className="conn__card conn__add">
          <strong>Connect a service</strong>
          <div className="conn__choices">
            {canMail && (
              <button className="conn__choice" onClick={() => { void connectMail(undefined, '/profile#connections').catch((e) => setErr(e.message)); }}>
                <Icon name="mail" size={16} /> A Google email inbox
              </button>
            )}
            {!twilio && (
              <button className="conn__choice" onClick={() => { setOpen(true); setAdding(false); }}>
                <Icon name="phone" size={16} /> Twilio — phone numbers &amp; texting
              </button>
            )}
          </div>
          <div className="conn__suggest">
            <strong>Don't see yours?</strong>
            <p className="conn__fine">Ask Lichen to connect it. Each new service is built and checked by Lichen's team before anyone's keys go into it, so it isn't instant — you'll get a bell with the answer.</p>
            {sugSent ? (
              <p className="conn__fine conn__ok">Sent ✓ — Lichen will let you know about {sugSent}.</p>
            ) : (
              <>
                <label className="conn__label">Which service?
                  <input className="conn__input" value={sugName} onChange={(e) => setSugName(e.target.value)} placeholder="e.g. QuickBooks, Square, Zoom" maxLength={80} />
                </label>
                <label className="conn__label">What would you want your Brain to do with it? (optional)
                  <textarea className="conn__input" rows={2} value={sugWhy} onChange={(e) => setSugWhy(e.target.value)} maxLength={1000} />
                </label>
                <div className="conn__acts">
                  <button className="conn__btn" disabled={busy || sugName.trim().length < 2} onClick={() => void suggest()}>Send to Lichen</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

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
            {numbers && !numbers.length && <p className="conn__fine">No phone numbers on this account yet.</p>}
            {numbers && numbers.length > 0 && (
              <ul className="conn__nums">
                {numbers.map((n) => (
                  <li key={n.number} className="conn__num">
                    <span>{n.number}{n.name && n.name !== n.number ? ` · ${n.name}` : ''}</span>
                    {n.wired
                      ? <span className="conn__status is-on">Answers through Lichen ✓</span>
                      : <button className="conn__btn" disabled={busy} onClick={() => void wire(n.number)}>Connect to Lichen</button>}
                  </li>
                ))}
              </ul>
            )}
            {numbers && numbers.length > 0 && (
              <p className="conn__fine">Connected numbers ring your own cell (the phone on your Lichen profile) for 20 seconds, then go to voicemail. Your Brain reads texts and voicemails there, and a bell rings for each new one.</p>
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

      <BrowserExtension />

      <h3 className="conn__h">What your Brain is watching for</h3>
      {canMail && inboxes.length > 0 && (() => {
        const imp = watches.find((w) => w.kind === 'important' && w.status === 'active');
        return (
          <div className="conn__imp">
            <div className="conn__watch-main">
              <strong>Let your Brain take a chance {imp ? '· on' : ''}</strong>
              <span className="conn__fine">
                Your Brain tells you about what you asked it to watch for. With this on, it may also take a chance on new mail it knows matters to you from your notebook below (a reply you’ve been waiting on, good news) — at most a few times a day, and each ping asks whether it was right.
                {imp?.query && imp.query !== 'anything important' && <> Listening especially for: {imp.query}.</>}
              </span>
            </div>
            {imp
              ? <button className="conn__btn conn__btn--quiet" onClick={() => void stopWatch(imp.id).then(load)}>Turn off</button>
              : <button className="conn__btn" onClick={() => void startImportantWatch().then(load).catch((e) => setErr(e instanceof Error ? e.message : String(e)))}>Turn on</button>}
          </div>
        );
      })()}
      {watches.filter((w) => w.kind !== 'important').length === 0 ? (
        <p className="conn__fine">Nothing yet. Tell your Brain something like “let me know when Twilio confirms my number transfer” and it will keep watch, checking every 10 minutes.</p>
      ) : (
        <ul className="conn__watches">
          {watches.filter((w) => w.kind !== 'important').map((w) => (
            <li key={w.id} className={'conn__watch' + (w.status === 'fired' ? ' is-fired' : '')}>
              <div className="conn__watch-main">
                <strong>{w.label}</strong>
                <span className="conn__fine">
                  {w.status === 'fired'
                    ? <>Came true {w.fired_at ? shortDate(w.fired_at) : ''}{w.convo_id && <> · <Link className="link-cue" to={`/assistant/feed?thread=general&convo=${w.convo_id}`}>See the note</Link></>}</>
                    : <>{w.kind === 'mail' ? 'Watching your email' : w.kind === 'wish' ? 'Wish list · watching Marketplace' : 'Watching your Twilio numbers'} · until {shortDate(w.expires_at)}</>}
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

      <h3 className="conn__h">What your Brain has learned about you</h3>
      <p className="conn__fine">Your Brain keeps this notebook as it gets to know you — from what you tell it, and from your answers when it takes a chance. Only you and your Brain read it. Add to it, or forget anything.</p>
      {notes.length > 0 && (
        <ul className="conn__watches">
          {notes.map((n) => (
            <li key={n.id} className="conn__watch">
              <div className="conn__watch-main">
                <strong>{n.note}</strong>
                <span className="conn__fine">{n.kind === 'quiet' ? 'Stay quiet about this' : 'Matters to you'} · {shortDate(n.created_at)}</span>
              </div>
              <button className="conn__btn conn__btn--quiet" onClick={() => void forgetNote(n.id).then(load)}>Forget</button>
            </li>
          ))}
        </ul>
      )}
      <div className="conn__noteadd">
        <select className="input" value={noteKind} onChange={(e) => setNoteKind(e.target.value as 'matters' | 'quiet')} aria-label="Kind of note">
          <option value="matters">Matters to me</option>
          <option value="quiet">Don’t ping me about</option>
        </select>
        <input className="input" value={noteText} onChange={(e) => setNoteText(e.target.value)} maxLength={400}
          placeholder={noteKind === 'matters' ? 'e.g. any reply about my Anthropic application' : 'e.g. shipping updates'} />
        <button className="conn__btn" disabled={!noteText.trim() || !user} onClick={() => {
          if (!user) return;
          void addNote(user.id, noteKind, noteText).then(() => { setNoteText(''); return load(); }).catch((e) => setErr(e instanceof Error ? e.message : String(e)));
        }}>Add</button>
      </div>
      {mine.length > 0 && !isAdmin && (
        <>
          <h3 className="conn__h">Services you've asked for</h3>
          <ul className="conn__watches">
            {mine.map((x) => (
              <li key={x.id} className={'conn__watch' + (x.status === 'built' ? ' is-fired' : '')}>
                <div className="conn__watch-main"><strong>{x.service}</strong><span className="conn__fine">{SUGG_WORD[x.status]}</span></div>
              </li>
            ))}
          </ul>
        </>
      )}

      {isAdmin && others.length > 0 && (
        <>
          <h3 className="conn__h">Services members asked for</h3>
          <ul className="conn__watches">
            {others.map((x) => (
              <li key={x.id} className={'conn__watch' + (x.status === 'built' ? ' is-fired' : '')}>
                <div className="conn__watch-main">
                  <strong>{x.service}</strong>
                  <span className="conn__fine">{x.who ?? 'A member'} · {shortDate(x.created_at)} · {SUGG_WORD[x.status]}</span>
                  {x.why && <span className="conn__fine">“{x.why}”</span>}
                </div>
                <div className="conn__acts">
                  {x.status !== 'planned' && <button className="conn__btn conn__btn--quiet" onClick={() => void decide(x.id, 'planned')}>Planned</button>}
                  {x.status !== 'built' && <button className="conn__btn conn__btn--quiet" onClick={() => void decide(x.id, 'built')}>Built</button>}
                  {x.status !== 'declined' && <button className="conn__btn conn__btn--quiet" onClick={() => void decide(x.id, 'declined')}>Not now</button>}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {err && <p className="conn__err">{err}</p>}
    </div>
  );
}
