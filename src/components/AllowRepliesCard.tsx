import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { allowMailReplies, listAllowances } from '../lib/assistantAllowanceApi';
import { sendMailDraft } from '../lib/mailApi';
import './MailDraftCard.css';

type HeldDraft = { account_id: string; account: string; message_id: string; to: string };

/** THE PERMISSION POP-UP (founder 2026-11-26: "just tell me im free to
 *  reply - its kinda like a permissions pop up you give me"). The member's
 *  words summon this card; only their tap grants the allowance. When a reply
 *  draft is waiting in the conversation it can go out in the same tap. */
export default function AllowRepliesCard({ draft }: { draft?: HeldDraft }) {
  const { user } = useAuth();
  const [state, setState] = useState<'loading' | 'ask' | 'busy' | 'allowed' | 'sent' | 'sentonly' | 'no'>('loading');
  const [err, setErr] = useState('');
  useEffect(() => {
    let live = true;
    if (!user) return;
    listAllowances(user.id)
      .then((rows) => { if (live) setState(rows.some((r) => r.kind === 'mail_reply') ? 'allowed' : 'ask'); })
      .catch(() => { if (live) setState('ask'); });
    return () => { live = false; };
  }, [user]);

  async function go(allow: boolean, send: boolean) {
    setErr(''); setState('busy');
    try {
      if (allow) await allowMailReplies();
      if (send && draft) await sendMailDraft(draft.account_id, draft.message_id);
      setState(send ? (allow ? 'sent' : 'sentonly') : 'allowed');
    } catch (e) {
      const m = (e as Error).message;
      // An allowance that landed before a draft that's already gone still stands.
      setErr(m); setState(allow ? 'allowed' : 'ask');
    }
  }

  if (state === 'loading') return null;
  if (state === 'no') return <p className="mdraft__hint">Okay — I’ll keep asking before I send.</p>;
  if (state === 'sentonly') return <p className="mdraft__done">Sent from {draft?.account} ✓ — I’ll still ask before the next one.</p>;
  if (state === 'allowed' || state === 'sent') {
    return (
      <p className="mdraft__done">
        {state === 'sent' ? <>Sent from {draft?.account} ✓ </> : null}
        Your Brain can answer replies for you now — only on threads you’re already in, and it tells you after.
        <br /><span className="mdraft__hint">Take it back any time in Profile → Privacy.</span>
        {err && <><br /><span className="mdraft__err">{err}</span></>}
      </p>
    );
  }
  const busy = state === 'busy';
  return (
    <div className="mdraft">
      <p className="mdraft__hint"><strong>Let your Brain send email replies for you?</strong></p>
      <p className="mdraft__hint">It will answer on threads you’re already in when it knows what you want, then tell you what it sent. It never sends a password, PIN or code, never agrees to pay or cancel, and asks you whenever it isn’t sure.</p>
      {err && <p className="mdraft__err">{err}</p>}
      <div className="mdraft__acts">
        <button type="button" className="mdraft__quiet" disabled={busy} onClick={() => setState('no')}>Not now</button>
        <span className="mdraft__spacer" />
        {draft && <button type="button" className="mdraft__quiet mdraft__always" disabled={busy} onClick={() => void go(false, true)}>Just send this one</button>}
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void go(true, !!draft)}>
          {busy ? 'One moment…' : draft ? `Allow, and send the reply to ${draft.to.replace(/<[^>]+>/, '').trim() || draft.to}` : 'Allow'}
        </button>
      </div>
    </div>
  );
}
