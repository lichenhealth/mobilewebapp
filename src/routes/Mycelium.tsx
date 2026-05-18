import { useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Icon, IconName } from '../components/Icon';
import {
  NETWORK_MEMBERS,
  NETWORK_LABELS,
  NetworkType,
  NetworkMember,
} from '../data/network';
import './Mycelium.css';

// URL slug → NetworkType (or 'all')
const URL_TO_TYPE: Record<string, NetworkType | 'all'> = {
  '': 'all',
  people: 'person',
  providers: 'provider',
  organizations: 'organization',
  places: 'place',
};

const TYPE_ICON: Record<NetworkType, IconName> = {
  person: 'profile',
  provider: 'store',
  organization: 'user-multiple',
  place: 'location',
};

export default function Mycelium() {
  const { type: urlSlug = '' } = useParams();
  const filterType = URL_TO_TYPE[urlSlug] ?? 'all';
  const [query, setQuery] = useState('');

  const members = useMemo<NetworkMember[]>(() => {
    let list = filterType === 'all'
      ? NETWORK_MEMBERS
      : NETWORK_MEMBERS.filter((m) => m.type === filterType);
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter(
        (m) =>
          m.name.toLowerCase().includes(q) ||
          m.handle.toLowerCase().includes(q) ||
          m.blurb.toLowerCase().includes(q)
      );
    }
    return list;
  }, [filterType, query]);

  const heading =
    filterType === 'all'
      ? 'Your Mycelium'
      : `Your ${NETWORK_LABELS[filterType]}`;
  const blurb =
    filterType === 'all'
      ? 'Everyone you\u2019re connected to \u2014 people, providers, organizations, places.'
      : filterType === 'person'
      ? 'Individuals in your trusted network.'
      : filterType === 'provider'
      ? 'People who make or grow or build something you can buy from or barter with.'
      : filterType === 'organization'
      ? 'Collectives, nonprofits, and groups operating in your network.'
      : 'Physical places members open up \u2014 gardens, studios, kitchens, fields.';

  return (
    <div className="myc">
      <header className="myc__head">
        <p className="myc__crumb">
          <Icon name="sparkle" size={11} />
          <span>Mycelium</span>
        </p>
        <h1 className="myc__title">{heading}</h1>
        <p className="myc__sub">{blurb}</p>
        <p className="myc__count">
          <span className="myc__count-n">{members.length}</span>{' '}
          {members.length === 1 ? 'connection' : 'connections'}
        </p>
      </header>

      <nav className="myc__tabs">
        <Link to="/mycelium" className={'myc__tab' + (filterType === 'all' ? ' is-active' : '')}>All</Link>
        <Link to="/mycelium/people" className={'myc__tab' + (filterType === 'person' ? ' is-active' : '')}>People</Link>
        <Link to="/mycelium/providers" className={'myc__tab' + (filterType === 'provider' ? ' is-active' : '')}>Providers</Link>
        <Link to="/mycelium/organizations" className={'myc__tab' + (filterType === 'organization' ? ' is-active' : '')}>Orgs</Link>
        <Link to="/mycelium/places" className={'myc__tab' + (filterType === 'place' ? ' is-active' : '')}>Places</Link>
      </nav>

      <div className="myc__search">
        <Icon name="search" size={14} />
        <input
          className="myc__search-input"
          placeholder="Search by name, handle, or note"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <ul className="myc__list">
        {members.map((m) => (
          <li key={m.id} className="myc__member">
            <div
              className="myc__avatar"
              style={{ background: m.color ?? 'var(--ink-soft)' }}
            >
              {m.monogram}
            </div>
            <div className="myc__body">
              <div className="myc__name-row">
                <h3 className="myc__name">{m.name}</h3>
                <span className="myc__type">
                  <Icon name={TYPE_ICON[m.type]} size={10} />
                  <span>{m.type}</span>
                </span>
              </div>
              <p className="myc__handle">{m.handle}</p>
              <p className="myc__blurb">{m.blurb}</p>
            </div>
          </li>
        ))}
        {members.length === 0 && (
          <li className="myc__empty">
            <span className="display-italic">No matches.</span>
            <p>Try a different word, or clear the filter.</p>
          </li>
        )}
      </ul>
    </div>
  );
}
