import { Link } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { GROUPS, getCommunity } from '../data/network';
import './Mycelium.css'; // reuse styles

export default function GroupList() {
  return (
    <div className="myc">
      <header className="myc__head">
        <p className="myc__crumb">
          <Icon name="user-multiple" size={11} />
          <span>Groups</span>
        </p>
        <h1 className="myc__title">Your Groups</h1>
        <p className="myc__sub">
          Smaller circles. Some live inside Communities, others are
          standalone. All have their own feed.
        </p>
        <p className="myc__count">
          <span className="myc__count-n">{GROUPS.length}</span>{' '}
          {GROUPS.length === 1 ? 'group' : 'groups'}
        </p>
      </header>

      <ul className="myc__list">
        {GROUPS.map((g) => {
          const parent = g.communityId ? getCommunity(g.communityId) : null;
          return (
            <li key={g.id} className="myc__member">
              <Link
                to={`/groups/${g.id}`}
                className="myc__avatar"
                style={{ background: 'var(--peach)', textDecoration: 'none' }}
              >
                {g.name.slice(0, 1)}
              </Link>
              <Link
                to={`/groups/${g.id}`}
                className="myc__body"
                style={{ textDecoration: 'none', color: 'inherit' }}
              >
                <div className="myc__name-row">
                  <h3 className="myc__name">{g.name}</h3>
                  <span className="myc__type">
                    <span>{g.members} members</span>
                  </span>
                </div>
                <p className="myc__handle">
                  {parent ? `inside ${parent.name}` : 'standalone'}
                </p>
                <p className="myc__blurb">{g.description}</p>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
