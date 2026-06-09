import { Icon } from './Icon';
import EngagementFooter from './EngagementFooter';
import { Listing, MODE_ICONS, MODE_LABELS } from '../data/marketplace';
import './MarketplaceCard.css';

interface Props {
  listing: Listing;
  onClick?: () => void;
}

export default function MarketplaceCard({ listing, onClick }: Props) {
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

      <EngagementFooter
        mycelium={listing.mycelium}
        trusted={listing.trusted}
        recommended={listing.recommended}
        saved={listing.saved}
        availability={listing.availability}
      />
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
