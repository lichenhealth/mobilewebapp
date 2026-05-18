import { useState } from 'react';
import FilterRow from '../components/FilterRow';
import { Icon } from '../components/Icon';
import { MEMBERS, GROUPS } from '../data/community';
import './Community.css';

const TABS = ['People', 'Groups', 'Discussions'];

export default function Community() {
  const [tab, setTab] = useState('People');

  return (
    <div className="community">
      <header className="community__head">
        <p className="eyebrow">Mycelium · 1,284 members</p>
        <h1 className="community__title">
          <span className="display">The network is</span>{' '}
          <span className="display-italic">quietly active.</span>
        </h1>
        <p className="community__sub">
          Trust travels slowly here — built through small acts, not follower counts.
        </p>
      </header>

      <FilterRow options={TABS} value={tab} onChange={setTab} />

      {tab === 'People' && <MemberList />}
      {tab === 'Groups' && <GroupList />}
      {tab === 'Discussions' && <DiscussionsPlaceholder />}
    </div>
  );
}

function MemberList() {
  return (
    <section className="community__list">
      {MEMBERS.map((m) => (
        <article key={m.handle} className="member-card">
          <div className="member-card__head">
            <div className="member-card__avatar">{m.monogram}</div>
            <div className="member-card__id">
              <h3 className="member-card__name">{m.name}</h3>
              <p className="member-card__handle">{m.handle}</p>
            </div>
            <button className="btn btn-ghost member-card__follow">
              <Icon name="plus" size={14} />
              Trust
            </button>
          </div>
          <p className="member-card__bio">{m.bio}</p>
          <div className="member-card__meta">
            <span className="member-card__metric">
              <Icon name="shield-user" size={12} />
              <span className="member-card__metric-n">{m.trustCount}</span> trust
            </span>
            <span className="member-card__metric">
              <Icon name="profile" size={12} />
              <span className="member-card__metric-n">{m.inCommon}</span> in common
            </span>
          </div>
          <div className="member-card__tags">
            {m.tags.map((t) => (
              <span key={t} className="tag">{t}</span>
            ))}
          </div>
        </article>
      ))}
    </section>
  );
}

function GroupList() {
  return (
    <section className="community__list">
      {GROUPS.map((g) => (
        <article key={g.name} className="group-card">
          <div className="group-card__icon">
            <Icon name="sparkle" size={18} />
          </div>
          <div className="group-card__body">
            <div className="group-card__row">
              <h3 className="group-card__name">{g.name}</h3>
              {g.active && <span className="group-card__pulse" aria-label="Active">●</span>}
            </div>
            <p className="group-card__desc">{g.description}</p>
            <p className="group-card__meta">
              <span className="member-card__metric-n">{g.members}</span> members
            </p>
          </div>
          <Icon name="arrow-right" size={16} />
        </article>
      ))}
    </section>
  );
}

function DiscussionsPlaceholder() {
  return (
    <section className="community__empty">
      <Icon name="message" size={32} />
      <p className="eyebrow">No new threads</p>
      <p className="community__empty-text">
        Discussions surface here when more than three trusted members are talking
        about the same thing. Quiet days are good days.
      </p>
    </section>
  );
}
