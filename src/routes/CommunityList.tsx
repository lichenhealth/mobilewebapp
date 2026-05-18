import { Link } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { COMMUNITIES } from '../data/network';
import './Mycelium.css'; // reuse styles

export default function CommunityList() {
  return (
    <div className="myc">
      <header className="myc__head">
        <p className="myc__crumb">
          <Icon name="sparkle" size={11} />
          <span>Communities</span>
        </p>
        <h1 className="myc__title">Your Communities</h1>
        <p className="myc__sub">
          Communities you&rsquo;re a member of. Each one has its own feed,
          its own groups within, its own rhythm.
        </p>
        <p className="myc__count">
          <span className="myc__count-n">{COMMUNITIES.length}</span>{' '}
          {COMMUNITIES.length === 1 ? 'community' : 'communities'}
        </p>
      </header>

      <ul className="myc__list">
        {COMMUNITIES.map((c) => (
          <li key={c.id} className="myc__member">
            <Link
              to={`/communities/${c.id}`}
              className="myc__avatar"
              style={{ background: 'var(--ink)', textDecoration: 'none' }}
            >
              {c.name.slice(0, 1)}
            </Link>
            <Link
              to={`/communities/${c.id}`}
              className="myc__body"
              style={{ textDecoration: 'none', color: 'inherit' }}
            >
              <div className="myc__name-row">
                <h3 className="myc__name">{c.name}</h3>
                <span className="myc__type">
                  <span>{c.members} members</span>
                </span>
              </div>
              <p className="myc__handle">{c.handle}</p>
              <p className="myc__blurb">{c.description}</p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
