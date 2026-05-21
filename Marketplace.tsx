import { useMemo, useState } from 'react';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import { Icon, IconName } from '../components/Icon';
import MarketplaceCard, { MarketplaceCardCompact } from '../components/MarketplaceCard';
import {
  LISTINGS,
  KIND_LABELS,
  ListingKind,
  ListingMode,
  MODE_LABELS,
} from '../data/marketplace';
import { parseScope, handlesInScope } from '../data/network';
import './Marketplace.css';

// URL slug → ListingKind (or 'all')
const URL_TO_KIND: Record<string, ListingKind | 'all'> = {
  '': 'all',
  goods: 'good',
  services: 'service',
  spaces: 'space',
  iso: 'iso',
};

interface ActionItem {
  icon: IconName;
  label: string;
  kind: 'search' | 'post' | 'mode-filter';
  mode?: ListingMode;
}

const ACTIONS: ActionItem[] = [
  { icon: 'search',         label: 'Search',  kind: 'search' },
  { icon: 'plus',           label: 'Post',    kind: 'post'   },
  { icon: 'heart-line',     label: 'Gift',    kind: 'mode-filter', mode: 'gift'     },
  { icon: 'trade',          label: 'Trade',   kind: 'mode-filter', mode: 'trade'    },
  { icon: 'rent',           label: 'Rent',    kind: 'mode-filter', mode: 'rent'     },
  { icon: 'lend',           label: 'Lend',    kind: 'mode-filter', mode: 'lend'     },
  { icon: 'sparkle',        label: 'Sliding', kind: 'mode-filter', mode: 'sliding'  },
  { icon: 'store',          label: 'Sale',    kind: 'mode-filter', mode: 'sale'     },
];

export default function Marketplace() {
  const { kind: urlSlug = '' } = useParams();
  const activeKind = URL_TO_KIND[urlSlug] ?? 'all';
  const [searchParams, setSearchParams] = useSearchParams();
  const scope = useMemo(() => parseScope(searchParams.get('from')), [searchParams]);

  const [activeMode, setActiveMode] = useState<ListingMode | null>(null);
  const [showSearch, setShowSearch] = useState(false);
  const [query, setQuery] = useState('');
  const [postNote, setPostNote] = useState(false);

  const filtered = useMemo(() => {
    let list = activeKind === 'all'
      ? LISTINGS
      : LISTINGS.filter((l) => l.kind === activeKind);
    if (scope) {
      const allowed = handlesInScope(scope);
      list = list.filter((l) => allowed.has(l.handle));
    }
    if (activeMode) {
      list = list.filter((l) => l.mode === activeMode);
    }
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter(
        (l) =>
          l.title.toLowerCase().includes(q) ||
          l.handle.toLowerCase().includes(q) ||
          l.body.toLowerCase().includes(q)
      );
    }
    return list;
  }, [activeKind, activeMode, query, scope]);

  const clearScope = () => {
    const next = new URLSearchParams(searchParams);
    next.delete('from');
    setSearchParams(next);
  };

  const handleAction = (action: ActionItem) => {
    if (action.kind === 'search') {
      setShowSearch((s) => !s);
      if (showSearch) setQuery('');
    } else if (action.kind === 'post') {
      setPostNote(true);
      setTimeout(() => setPostNote(false), 2400);
    } else if (action.kind === 'mode-filter' && action.mode) {
      setActiveMode((m) => (m === action.mode ? null : action.mode!));
    }
  };

  return (
    <div className="mkt">
      <header className="mkt__head">
        <p className="mkt__crumb">
          <Icon name="store" size={11} />
          <span>Marketplace</span>
        </p>
        <h1 className="mkt__title">
          What members are <span className="display-italic">offering &amp; seeking.</span>
        </h1>
        <p className="mkt__sub">
          Goods, services, spaces, and things people are looking for.
          Trust the trader, not the platform.
        </p>
      </header>

      {/* Scope banner — visible when filtered to a community/group/type */}
      {scope && (
        <div className="mkt__scope">
          <span className="mkt__scope-eyebrow">Filtered to</span>
          <span className="mkt__scope-label">{scope.label}</span>
          <span className="mkt__scope-kind">{scope.kind}</span>
          <button
            className="mkt__scope-clear"
            onClick={clearScope}
            aria-label="Clear scope filter"
          >
            Show all
          </button>
        </div>
      )}

      {/* Kind tabs */}
      <nav className="mkt__tabs">
        {([
          { slug: '',         label: 'All',      kind: 'all'     },
          { slug: '/goods',    label: 'Goods',    kind: 'good'    },
          { slug: '/services', label: 'Services', kind: 'service' },
          { slug: '/spaces',   label: 'Spaces',   kind: 'space'   },
          { slug: '/iso',      label: 'ISO',      kind: 'iso'     },
        ] as const).map((t) => {
          const qs = scope ? `?from=${scope.kind}:${scope.id}` : '';
          return (
            <Link
              key={t.label}
              to={`/market${t.slug}${qs}`}
              className={'mkt__tab' + (activeKind === t.kind ? ' is-active' : '')}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>

      {/* Action chips */}
      <div className="mkt__actions h-scroll">
        {ACTIONS.flatMap((a, i) => {
          const active =
            (a.kind === 'search' && showSearch) ||
            (a.kind === 'mode-filter' && activeMode === a.mode);
          const nodes = [];
          // Insert a visual gap when transitioning from action buttons to mode filters
          if (a.kind === 'mode-filter' && i > 0 && ACTIONS[i - 1].kind !== 'mode-filter') {
            nodes.push(<div key={`${a.label}-spacer`} className="mkt__action-spacer" />);
          }
          nodes.push(
            <button
              key={a.label}
              className={'mkt__action' + (active ? ' is-active' : '')}
              onClick={() => handleAction(a)}
            >
              <span className="mkt__action-circle">
                <Icon name={a.icon} size={14} />
              </span>
              <span className="mkt__action-label">{a.label}</span>
            </button>
          );
          return nodes;
        })}
      </div>

      {/* Search input (toggleable) */}
      {showSearch && (
        <div className="mkt__search">
          <Icon name="search" size={14} />
          <input
            autoFocus
            className="mkt__search-input"
            placeholder="Search listings by title, handle, or description"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button
              className="mkt__search-clear"
              onClick={() => setQuery('')}
              aria-label="Clear"
            >
              <Icon name="close" size={12} />
            </button>
          )}
        </div>
      )}

      {/* Active filter notice */}
      {activeMode && (
        <p className="mkt__filter-notice">
          Filtering by <strong>{MODE_LABELS[activeMode]}</strong>
          <button onClick={() => setActiveMode(null)}>clear</button>
        </p>
      )}

      {/* Result count */}
      <p className="mkt__count">
        <span className="mkt__count-n">{filtered.length}</span>{' '}
        {filtered.length === 1 ? 'listing' : 'listings'}
        {activeKind !== 'all' && ` in ${KIND_LABELS[activeKind]}`}
      </p>

      {/* Listings */}
      <section className="mkt__list">
        {filtered.length === 0 && (
          <div className="mkt__empty">
            <Icon name="store" size={20} />
            <p>
              <span className="display-italic">Nothing here yet.</span>
            </p>
            <p className="mkt__empty-sub">
              Try clearing filters or check back when the market is fuller.
            </p>
          </div>
        )}
        {/* First few cards full-size, rest compact (matches wireframe pattern) */}
        {filtered.slice(0, 4).map((l) => (
          <MarketplaceCard key={l.id} listing={l} />
        ))}
        {filtered.length > 4 && (
          <div className="mkt__compact-section">
            <p className="eyebrow">More in this section</p>
            {filtered.slice(4).map((l) => (
              <MarketplaceCardCompact key={l.id} listing={l} />
            ))}
          </div>
        )}
      </section>

      {/* Post-listing toast */}
      {postNote && (
        <div className="mkt__toast">
          Posting a listing is being set up &mdash; coming soon.
        </div>
      )}

      <footer className="mkt__end">
        <span className="eyebrow">End of market</span>
        <Icon name="sparkle" size={14} />
      </footer>
    </div>
  );
}
