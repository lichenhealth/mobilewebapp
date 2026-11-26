import { useState } from 'react';
import { Link } from 'react-router-dom';
import { sendMailDraft, discardMailDraft } from '../lib/mailApi';
import { allowMailReplies } from '../lib/assistantAllowanceApi';
import './MailDraftCard.css';

/** AN EMAIL THE BRAIN DRAFTED, WITH ITS SEND BUTTON (founder 2026-11-15:
 *  "i am trying to send this via connect@lichen.health from my claude brain
 *  on lichen but there's no send button"). The draft already sits in Gmail;
 *  this card lets the person edit it and tap Send — the only way it goes. */
export default function MailDraftCard({ accountId, account, threadId, messageId, to: to0, cc: cc0, subject, body, reply }: {
  accountId: string; account: string; threadId: string; messageId: string; to: string; cc?: string; subject: string; body: string;
  /** A reply on an existing thread — offers "Always send replies for me". */
  reply?: boolean;
}) {
  const [to, setTo] = useState(to0);
  const [cc, setCc] = useState(cc0 ?? '');
  const [text, setText] = useState(body);
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'discarded'>('idle');
  const [err, setErr] = useState('');
  const [always, setAlways] = useState(false);
  const edited = to !== to0 || cc !== (cc0 ?? '') || text !== body;

  // ALWAYS SEND REPLIES FOR ME (founder 2026-11-26): one tap sends this
  // reply AND lets the brain send replies like it on its own from now on —
  // only on threads you're already in, never with a password, PIN or code.
  async function send(allow = false) {
    setErr(''); setState('sending');
    try {
      if (allow) { await allowMailReplies(); setAlways(true); }
      await sendMailDraft(accountId, messageId, edited
        ? { accountId, threadId: threadId || undefined, to, cc: cc || undefined, subject, body: text } : undefined);
      setState('sent');
    } catch (e) { setErr((e as Error).message); setState('idle'); }
  }
  async function discard() {
    setErr('');
    try { await discardMailDraft(accountId, messageId); setState('discarded'); }
    catch (e) { setErr((e as Error).message); }
  }

  const door = threadId ? `/mail?thread=${accountId}:${encodeURIComponent(threadId)}` : '/mail';
  if (state === 'sent') return (
    <p className="mdraft__done">Sent from {account} ✓ · <Link className="link-cue" to={door}>See it in Mail</Link>
      {always && <><br /><span className="mdraft__hint">From now on I’ll send replies like this myself, and tell you after. Take that back any time in Profile → Privacy.</span></>}</p>
  );
  if (state === 'discarded') return <p className="mdraft__hint">Draft discarded.</p>;
  return (
    <div className="mdraft">
      <p className="mdraft__hint"><strong>Draft email</strong> · from {account}{subject ? <> · {subject}</> : null}</p>
      <label className="mdraft__field"><span>To</span>
        <input value={to} onChange={(e) => setTo(e.target.value)} autoCapitalize="none" autoCorrect="off" spellCheck={false} /></label>
      <label className="mdraft__field"><span>Cc</span>
        <input value={cc} onChange={(e) => setCc(e.target.value)} autoCapitalize="none" autoCorrect="off" spellCheck={false} /></label>
      <textarea className="mdraft__box" rows={8} value={text} onChange={(e) => setText(e.target.value)} />
      {err && <p className="mdraft__err">{err}</p>}
      <div className="mdraft__acts">
        <Link className="mdraft__open" to={door}>Open in Mail</Link>
        <span className="mdraft__spacer" />
        <button type="button" className="mdraft__quiet" onClick={() => void discard()}>Discard</button>
        {reply && (
          <button type="button" className="mdraft__quiet mdraft__always" disabled={state === 'sending' || !to.trim() || text.trim().length < 2} onClick={() => void send(true)}>
            Send · always send replies for me
          </button>
        )}
        <button type="button" className="btn btn-primary" disabled={state === 'sending' || !to.trim() || text.trim().length < 2} onClick={() => void send()}>
          {state === 'sending' ? 'Sending…' : 'Send'}
        </button>
      </div>
      {reply && <p className="mdraft__hint mdraft__alwaysnote">“Always” lets me answer replies myself — only on threads you’re already in, never with a password, PIN or code, and never agreeing to pay or cancel.</p>}
    </div>
  );
}
