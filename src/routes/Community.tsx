import { useState } from 'react';
import { useParams, Navigate, Link } from 'react-router-dom';
import FilterRow from '../components/FilterRow';
import IconRow from '../components/IconRow';
import CommunityCard from '../components/CommunityCard';
import { Icon } from '../components/Icon';
import {
  getCommunity,
  COMMUNITY_FEEDS,
  GROUPS,
} from '../data/network';
import './Community.css';

export default function Community() {
  const { id = '' } = useParams();
  const community = getCommunity(id);
  const [filter, setFilter] = useState('All');

  // Unknown community → redirect to first available
  if (!community) {
    return <Navigate to="/communities/mons-sana" replace />;
  }

  const posts = COMMUNITY_FEEDS[community.id] ?? [];
  const childGroups = GROUPS.filter((g) => g.communityId === community.id);

  return (
    <div className="cmty">
      <header className="cmty__head">
        <p className="cmty__crumb">
          <Icon name="profile" size={11} />
          <span>{'Mycelium \u00B7 You\u2019re a member'}</span>
        </p>
        <h1 className="cmty__title">{community.name}</h1>
        <p className="cmty__sub">{community.description}</p>
        <div className="cmty__meta">
          <span className="cmty__meta-item">
            <span className="cmty__meta-n">{community.members}</span> members
          </span>
          <span className="cmty__meta-sep" aria-hidden="true">·</span>
          <span className="cmty__meta-item">
            <span className="cmty__meta-n">{community.newThisWeek}</span> new this week
          </span>
        </div>
      </header>

      <FilterRow options={community.filters} value={filter} onChange={setFilter} />

      <IconRow items={community.categoryIcons} />

      {childGroups.length > 0 && (
        <section className="cmty__groups">
          <p className="eyebrow eyebrow--center">Groups within {community.name}</p>
          <div className="cmty__groups-list">
            {childGroups.map((g) => (
              <Link key={g.id} to={`/groups/${g.id}`} className="cmty__group-chip">
                <span className="cmty__group-name">{g.name}</span>
                <span className="cmty__group-meta">
                  <span className="cmty__group-n">{g.members}</span> members
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="cmty__feed">
        {posts.map((c, i) => (
          <CommunityCard key={i} {...c} />
        ))}
        {posts.length === 0 && (
          <p className="cmty__empty">
            <span className="display-italic">Quiet here for now.</span><br />
            Be the first to share something with the {community.name} circle.
          </p>
        )}
      </section>

      <footer className="cmty__end">
        <span className="eyebrow">End of feed</span>
        <Icon name="sparkle" size={14} />
      </footer>
    </div>
  );
}
