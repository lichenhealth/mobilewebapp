import { useState } from 'react';
import { exportMyLichen } from '../lib/exportMyLichen';

// DOWNLOAD MY LICHEN (founder 2026-11-06) — Profile → Privacy. One JSON of
// everything that's yours, plus your guest lists as a contacts CSV.
export default function DownloadMyLichen({ me, email }: { me: string; email: string | null }) {
  const [state, setState] = useState<'idle' | 'working' | 'done' | 'error'>('idle');
  const [summary, setSummary] = useState('');
  async function go() {
    setState('working');
    try {
      const { counts } = await exportMyLichen(me, email);
      const posts = counts.posts ?? 0;
      const files = counts.drive_files ?? 0;
      const lists = counts.guest_lists ?? 0;
      setSummary(`${posts} post${posts === 1 ? '' : 's'}, ${files} Drive file${files === 1 ? '' : 's'}, ${lists} guest list${lists === 1 ? '' : 's'} and the rest of your account.`);
      setState('done');
    } catch (e) {
      console.error(e); setState('error');
    }
  }
  return (
    <div className="dml">
      <p className="dml__text">
        A copy of everything that’s yours — your profile, posts, drafts, Drive, guest lists,
        events, bookings, care entries, budget and Current‑cy statement — as a file you keep.
        Other members’ private details are never included.
      </p>
      <button className="dml__btn" disabled={state === 'working'} onClick={() => void go()}>
        {state === 'working' ? 'Gathering…' : 'Download my Lichen'}
      </button>
      {state === 'done' && <p className="dml__ok">Downloaded ✓ — {summary} Drive file links inside work for 7 days.</p>}
      {state === 'error' && <p className="dml__err">Something went wrong gathering it — try again in a moment.</p>}
    </div>
  );
}
