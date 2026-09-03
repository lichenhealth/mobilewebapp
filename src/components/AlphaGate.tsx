import './AlphaGate.css';

/** The alpha-state notice shown BEFORE a knock is sent (founder 2026-09-03:
 *  "write that copy on a pop up before you request an invite" — prepare
 *  people for the state of the platform, never over-promise; the invite
 *  email itself is a thank-you). Shared by /signup's knock and a space
 *  page's KnockForm so the promise can't drift between doors. */
export default function AlphaGate({ onConfirm, onCancel, busy }: {
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
}) {
  return (
    <div className="agate__overlay" role="dialog" aria-modal="true" aria-labelledby="agate-title">
      <div className="agate__card">
        <p className="agate__eyebrow">Before you knock</p>
        <h2 className="agate__title" id="agate-title">You&rsquo;d be joining as an alpha tester</h2>
        <p className="agate__body">
          The entire foundation of the corrective social network and healthcare
          system is built — care teams, community, events, offerings and a
          fairer economy, one trusted web. But many aspects of it are in
          development and some are not yet built. <strong>There will be
          bugs.</strong> You&rsquo;ll suggest the features you need, and
          we&rsquo;ll implement them.
        </p>
        <p className="agate__body">That&rsquo;s the honest state of it — and the invitation.</p>
        <div className="agate__actions">
          <button className="btn btn-primary" type="button" onClick={onConfirm} disabled={busy}>
            {busy ? 'Sending…' : 'Count me in'}
          </button>
          <button className="agate__back" type="button" onClick={onCancel} disabled={busy}>
            Not yet
          </button>
        </div>
      </div>
    </div>
  );
}
