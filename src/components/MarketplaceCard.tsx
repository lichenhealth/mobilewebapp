import { useState } from 'react';
import { Icon } from './Icon';
import { Listing, MODE_ICONS, MODE_LABELS } from '../data/marketplace';
import './MarketplaceCard.css';

interface Props {
  listing: Listing;
  onClick?: () => void;
}

export default function MarketplaceCard({ listing, onClick }: Props) {
  const [trusted, setTrusted] = useState(listing.trusted ?? false);
  const [recommended, setRecommended] = useState(listing.recommended ?? false);
  const [saved, setSaved] = useState(listing.saved ?? false);
  const [trustCount, setTrustCount] = useState(listing.trust);
  const [recCount, setRecCount] = useState(listing.recommends);

  const toggleTrust = (e: React.MouseEvent) => {
    e.stopPropagation();
    setTrusted((t) => {
      setTrustCount((c) => c + (t ? -1 : 1));
      return !t;
    });
  };
  const toggleRec = (e: React.MouseEvent) => {
    e.stopPropagation();
    setRecommended((t) => {
      setRecCount((c) => c + (t ? -1 : 1));
      return !t;
    });
  };
  const toggleSave = (e: React.MouseEvent) => {
    e.stopPropagation();
    setSaved((s) => !s);
  };

  return (
    <article className="mkt-card" onClick={onClick}>
      <header className="mkt-card__head">
        <div
          className="mkt-card__avatar"
          style={{ background: listing.color ?? 'var(--ink-soft)' }}
          aria-hidden="true"
        >
          {listing.monogram}
        </div>
        <div className="mkt-card__id">
          <h3 className="mkt-card__title">{listing.title}</h3>
          <p className="mkt-card__handle">{listing.handle}</p>
        </div>
        <div className="mkt-card__mode" title={MODE_LABELS[listing.mode]}>
          <Icon name={MODE_ICONS[listing.mode]} size={20} />
        </div>
      </header>

      <p className="mkt-card__body">{listing.body}</p>

      <div className="mkt-card__meta">
        <span className="mkt-card__price">{listing.price}</span>
        {listing.location && (
          <span className="mkt-card__loc">
            <Icon name="location" size={10} />
            <span>{listing.location}</span>
          </span>
        )}
        <span className="mkt-card__mode-chip">
          {MODE_LABELS[listing.mode]}
        </span>
      </div>

      <footer className="mkt-card__foot">
        <button
          className={'mkt-card__action' + (trusted ? ' is-active' : '')}
          onClick={toggleTrust}
        >
          <Icon name="shield-user" size={12} />
          <span>Trust</span>
          <span className="mkt-card__count">{trustCount}</span>
        </button>
        <button
          className={'mkt-card__action' + (recommended ? ' is-active' : '')}
          onClick={toggleRec}
        >
          <Icon name="thumbs-up" size={12} />
          <span>Recommend</span>
          <span className="mkt-card__count">{recCount}</span>
        </button>
        <button className="mkt-card__action" onClick={(e) => e.stopPropagation()}>
          <Icon name="send" size={12} />
          <span>Share</span>
        </button>
        <button
          className={'mkt-card__action' + (saved ? ' is-active' : '')}
          onClick={toggleSave}
        >
          <Icon name="bookmark" size={12} />
          <span>Save</span>
        </button>
        <button className="mkt-card__action" onClick={(e) => e.stopPropagation()}>
          <Icon name="message" size={12} />
          <span>Chat</span>
        </button>
      </footer>
    </article>
  );
}

/** Compact card variant — single row, no body or footer */
export function MarketplaceCardCompact({ listing, onClick }: Props) {
  return (
    <article className="mkt-card mkt-card--compact" onClick={onClick}>
      <div
        className="mkt-card__avatar"
        style={{ background: listing.color ?? 'var(--ink-soft)' }}
      >
        {listing.monogram}
      </div>
      <div className="mkt-card__id">
        <h3 className="mkt-card__title">{listing.title}</h3>
        <p className="mkt-card__handle">{listing.handle}</p>
      </div>
      <div className="mkt-card__compact-price">{listing.price}</div>
      <div className="mkt-card__mode mkt-card__mode--sm" title={MODE_LABELS[listing.mode]}>
        <Icon name={MODE_ICONS[listing.mode]} size={16} />
      </div>
    </article>
  );
}
