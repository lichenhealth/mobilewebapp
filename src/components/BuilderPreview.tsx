import './BuilderPreview.css';

/** The page beside the builder (founder 2026-08-22: "page builder on the
 *  left and the preview on the right") — the manual twin of the assistant
 *  thread's page-beside-conversation split. The frame is the REAL page in
 *  preview mode; it shows the last SAVE, so the foot says so and Save (or
 *  Refresh) brings it current. Below the desktop breakpoint a whole page
 *  beside a form teaches nobody anything — phones get the honest
 *  open-in-a-tab door instead, the afeed pattern. */
export default function BuilderPreview({ frameSrc, tabHref, nonce, onRefresh }: {
  /** The embedded page (…?preview=1&embed=1 — chrome stood down). */
  frameSrc: string;
  /** The same page for a human-sized tab (no embed). */
  tabHref: string;
  /** Bump to reload the frame — wire it to the builder's Save. */
  nonce: number;
  onRefresh: () => void;
}) {
  return (
    <aside className="bprev">
      <div className="bprev__wide">
        <iframe className="bprev__frame" key={nonce} src={frameSrc} title="Page preview" />
        <div className="bprev__foot">
          <button className="bprev__btn" type="button" onClick={onRefresh}>Refresh</button>
          <button className="bprev__btn" type="button" onClick={() => window.open(tabHref, '_blank')}>
            Open in a new tab
          </button>
        </div>
        <p className="bprev__note">
          The page as visitors see it. It shows your last save &mdash; press Save, and it catches up.
        </p>
      </div>
      <p className="bprev__narrow">
        Building with the page in view needs a wider screen &mdash;{' '}
        <button className="bprev__btn" type="button" onClick={() => window.open(tabHref, '_blank')}>
          open the preview in its own tab
        </button>{' '}
        and flip between the two.
      </p>
    </aside>
  );
}
