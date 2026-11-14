import { useEffect, useState } from 'react';
import { connectMail, listMailAccounts, type MailAccount } from '../lib/mailApi';
import { Icon } from './Icon';

/** THE BRAIN'S RECONNECT CARD (founder 2026-11-14: "i know the brain can't
 *  sign in to google for me - but could we make this as easy as possible and
 *  have the brain do as much as possible?"). One button per inbox opens
 *  Google's own consent screen with that address pre-filled, and Google sends
 *  you straight back to THIS conversation. An inbox counts as done once it was
 *  connected after the card was written; when every one is, "carry on" hands
 *  the job back to the brain in your words. */
export default function MailReconnectCard({ accounts, since, onCarryOn }: {
  accounts: string[]; since: string; onCarryOn: () => void;
}) {
  const [rows, setRows] = useState<MailAccount[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const [sent, setSent] = useState(false);

  useEffect(() => {
    let live = true;
    const load = () => void listMailAccounts().then((r) => { if (live) setRows(r); }).catch(() => {});
    load();
    // Coming back from Google lands on this page again — re-read on focus too.
    const onVis = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { live = false; document.removeEventListener('visibilitychange', onVis); };
  }, []);

  const sinceMs = new Date(since).getTime();
  const list = accounts.map((email) => {
    const a = rows?.find((r) => r.email.toLowerCase() === email.toLowerCase());
    const done = !!a && !a.last_error && new Date(a.connected_at).getTime() > sinceMs;
    return { email, done };
  });
  const allDone = rows !== null && list.every((x) => x.done);

  function go(email: string) {
    setBusy(email); setErr('');
    // Back to exactly this conversation, minus any earlier round trip's flags.
    const q = new URLSearchParams(window.location.search);
    q.delete('mail'); q.delete('account');
    const path = window.location.pathname + (q.toString() ? `?${q.toString()}` : '');
    void connectMail(email, path).catch((e) => { setErr(e instanceof Error ? e.message : 'That didn’t open.'); setBusy(null); });
  }

  return (
    <div className="mailrc">
      <p className="mailrc__lead">
        <Icon name="mail" size={14} /> Google needs you to say yes once more — one tap per inbox, then you land right back here.
      </p>
      <ul className="mailrc__list">
        {list.map((x) => (
          <li key={x.email} className={x.done ? 'is-done' : ''}>
            <span className="mailrc__email">{x.email}</span>
            {x.done
              ? <span className="mailrc__ok">Reconnected ✓</span>
              : <button className="afeed__pubbtn" disabled={!!busy} onClick={() => go(x.email)}>{busy === x.email ? 'Opening Google…' : 'Reconnect'}</button>}
          </li>
        ))}
      </ul>
      {allDone && !sent && (
        <button className="afeed__pubbtn mailrc__go" onClick={() => { setSent(true); onCarryOn(); }}>All set — carry on ›</button>
      )}
      {allDone && sent && <p className="mailrc__fine">Handed back — I’m on it.</p>}
      {!allDone && <p className="mailrc__fine">Google asks “which account?” — pick the one shown. Nothing here signs you in for you; it just saves the hunting.</p>}
      {err && <p className="mailrc__err">{err}</p>}
    </div>
  );
}
