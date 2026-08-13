import { useState } from 'react';
import { Icon } from './Icon';
import { requestHomeSummary } from '../lib/snapshotApi';

/** One click: Claude reads the whole story and writes the homepage welcome
 *  (founder 2026-08-11 — "a smart summary… versus just the first part"). */
export default function HomeSummaryButton({ story, entityName, onWritten }: {
  story: string; entityName?: string; onWritten: (text: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  return (
    <>
      <button
        className="bmode__inline"
        type="button"
        disabled={busy || !story.trim()}
        onClick={async () => {
          setBusy(true); setErr('');
          try { onWritten(await requestHomeSummary(story, entityName)); }
          catch (e) { setErr((e as Error)?.message || 'Could not write that.'); }
          setBusy(false);
        }}
      >
        <Icon name="brain" size={12} />
        {busy ? 'Reading your story…' : 'Have Claude write this from the full story'}
      </button>
      {!story.trim() && <p className="prof__hint">Write your story below first.</p>}
      {err && <p className="prof__error">{err}</p>}
    </>
  );
}
