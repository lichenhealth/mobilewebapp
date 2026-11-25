import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { addNote, feedbackNote, listNotebook } from '../lib/notebookApi';
import './KnockReply.css';

/** The two teach-me buttons under a ping the brain sent unasked (founder
 *  2026-11-25: "learns to proactively notify me over time"). Each answer is a
 *  note in the member's notebook, which the brain reads the next time it
 *  decides whether to reach out. */
export default function PingFeedback({ about, wish }: { about: string; wish?: string }) {
  const { user } = useAuth();
  const [done, setDone] = useState<'matters' | 'quiet' | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    let live = true;
    listNotebook().then((rows) => {
      if (!live) return;
      if (rows.some((r) => r.note === feedbackNote('matters', about, wish))) setDone('matters');
      else if (rows.some((r) => r.note === feedbackNote('quiet', about, wish))) setDone('quiet');
    }).catch(() => {});
    return () => { live = false; };
  }, [about, wish]);
  async function answer(kind: 'matters' | 'quiet') {
    if (!user) return;
    setErr('');
    try { await addNote(user.id, kind, feedbackNote(kind, about, wish), 'feedback'); setDone(kind); }
    catch (e) { setErr((e as Error).message); }
  }
  if (done) {
    return <p className="kreply__done">{done === 'matters' ? 'Noted ✓ — I’ll keep reaching out about things like this.' : 'Noted ✓ — I’ll stay quiet about things like this.'}</p>;
  }
  return (
    <div className="kreply__acts">
      <button type="button" className="kreply__chip" onClick={() => void answer('matters')}>{wish ? 'Good find' : 'Glad you told me'}</button>
      <button type="button" className="kreply__notnow" onClick={() => void answer('quiet')}>{wish ? 'Not what I want' : 'Don’t ping me about this'}</button>
      {err && <p className="kreply__err">{err}</p>}
    </div>
  );
}
