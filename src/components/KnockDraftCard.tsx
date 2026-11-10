import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { replyToKnock } from '../lib/knockReplyApi';
import './KnockReply.css';

/** The assistant's drafted reply to someone at the door (founder 2026-11-10:
 *  "type in the assistant what you want sent to the person and they should
 *  be able to send for you"). Editable; Send is the person's own tap, riding
 *  their session through knock-reply's RLS read. A draft whose words already
 *  went out (the knock's last_reply) reads as sent on reload. */
export default function KnockDraftCard({ knockId, name, email, message }: {
  knockId: string; name: string; email: string; message: string;
}) {
  const [text, setText] = useState(message);
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'dismissed'>('idle');
  const [err, setErr] = useState('');

  useEffect(() => {
    let live = true;
    void supabase.from('join_requests').select('last_reply,status').eq('id', knockId).maybeSingle()
      .then(({ data }) => {
        const r = data as { last_reply: string | null } | null;
        if (live && r?.last_reply && r.last_reply.trim() === message.trim()) setState('sent');
      });
    return () => { live = false; };
  }, [knockId, message]);

  const first = name.trim().split(/\s+/)[0] || email;

  async function send() {
    setErr(''); setState('sending');
    try { await replyToKnock(knockId, text); setState('sent'); }
    catch (e) { setErr((e as Error).message); setState('idle'); }
  }

  if (state === 'sent') return <p className="kreply__done">Sent to {first} ✓ · they're still at the door until you decide</p>;
  if (state === 'dismissed') return <p className="kreply__hint">Not sent.</p>;
  return (
    <div className="kreply kreply--open kreply--card">
      <p className="kreply__hint"><strong>Reply to {name || email}</strong> · {email} — they won't be let in; their reply comes to your inbox.</p>
      <textarea className="kreply__box" rows={6} value={text} onChange={(e) => setText(e.target.value)} />
      {err && <p className="kreply__err">{err}</p>}
      <div className="kreply__acts">
        <span className="kreply__spacer" />
        <button type="button" className="kreply__notnow" onClick={() => setState('dismissed')}>Not now</button>
        <button type="button" className="btn btn-primary" disabled={state === 'sending' || text.trim().length < 2} onClick={send}>
          {state === 'sending' ? 'Sending…' : `Send to ${first}`}
        </button>
      </div>
    </div>
  );
}
