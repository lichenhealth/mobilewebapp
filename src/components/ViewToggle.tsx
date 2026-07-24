/** Browse-grid / card-feed switch, riding a count row's right edge.
 *  Styles live in Marketplace.css (.mkt__views) — both section families
 *  (Marketplace, AreaFeed) already import it. */
export default function ViewToggle({ view, onChange }: {
  view: 'browse' | 'feed';
  onChange: (v: 'browse' | 'feed') => void;
}) {
  return (
    <span className="mkt__views" role="tablist" aria-label="View">
      <button
        className={'mkt__viewbtn' + (view === 'browse' ? ' is-on' : '')}
        onClick={() => onChange('browse')}
        aria-label="Browse grid" title="Browse"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
          <rect x="1.5" y="1.5" width="5" height="5" rx="1" /><rect x="9.5" y="1.5" width="5" height="5" rx="1" />
          <rect x="1.5" y="9.5" width="5" height="5" rx="1" /><rect x="9.5" y="9.5" width="5" height="5" rx="1" />
        </svg>
      </button>
      <button
        className={'mkt__viewbtn' + (view === 'feed' ? ' is-on' : '')}
        onClick={() => onChange('feed')}
        aria-label="Card feed" title="Feed"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
          <rect x="1.5" y="2" width="13" height="4.6" rx="1" /><rect x="1.5" y="9.4" width="13" height="4.6" rx="1" />
        </svg>
      </button>
    </span>
  );
}
