import { useState } from 'react';
import { useParams, Navigate, Link } from 'react-router-dom';
import FilterRow from '../components/FilterRow';
import IconRow, { IconRowItem } from '../components/IconRow';
import CommunityCard from '../components/CommunityCard';
import { Icon, IconName } from '../components/Icon';
import {
  getGroup,
  getCommunity,
  GROUP_FEEDS,
} from '../data/network';
import './Community.css'; // reuse layout

const SCOPE_DESTINATIONS: Partial<Record<IconName, string>> = {
  store: '/market',
};

export default function Group() {
  const { id = '' } = useParams();
  const group = getGroup(id);
  const [filter, setFilter] = useState('All');

  if (!group) {
    return <Navigate to="/groups" replace />;
  }

  const posts = GROUP_FEEDS[group.id] ?? [];
  const parent = group.communityId ? getCommunity(group.communityId) : null;

  // Store icon → /market?from=group:<id>, filtering to this group's members.
  // Also inserts a divider between compose actions and destination icons.
  const scopedIcons: IconRowItem[] = group.categoryIcons.map((ci, i, arr) => {
    const dest = SCOPE_DESTINATIONS[ci.icon];
    const isCompose = ci.icon === 'search' || ci.icon === 'plus';
    const prevWasCompose = i > 0 && (arr[i - 1].icon === 'search' || arr[i - 1].icon === 'plus');
    return {
      ...ci,
      to: dest ? `${dest}?from=group:${group.id}` : undefined,
      divider: !isCompose && prevWasCompose,
    };
  });

  return (
    <div className="cmty">
      <header className="cmty__head">
        <p className="cmty__crumb">
          {parent ? (
            <>
              <Icon name="profile" size={11} />
              <span>
                <Link to={`/communities/${parent.id}`} className="cmty__crumb-link">
                  {parent.name}
                </Link>
                {' \u00B7 Group'}
              </span>
            </>
          ) : (
            <>
              <Icon name="user-multiple" size={11} />
              <span>{'Group \u00B7 standalone'}</span>
            </>
          )}
        </p>
        <h1 className="cmty__title">{group.name}</h1>
        <p className="cmty__sub">{group.description}</p>
        <div className="cmty__meta">
          <span className="cmty__meta-item">
            <span className="cmty__meta-n">{group.members}</span> members
          </span>
        </div>
      </header>

      <FilterRow options={group.filters} value={filter} onChange={setFilter} />

      <IconRow items={scopedIcons} />

      <section className="cmty__feed">
        {posts.map((c, i) => (
          <CommunityCard key={i} {...c} />
        ))}
        {posts.length === 0 && (
          <p className="cmty__empty">
            <span className="display-italic">Quiet here for now.</span><br />
            Be the first to share something with the {group.name} group.
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
