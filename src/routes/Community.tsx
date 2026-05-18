import { useState } from 'react';
import FilterRow from '../components/FilterRow';
import IconRow, { IconRowItem } from '../components/IconRow';
import CommunityCard from '../components/CommunityCard';
import { Icon } from '../components/Icon';
import { MONS_SANA, COMMUNITY_FEED } from '../data/community';
import './Community.css';

const FILTERS = ['All', 'Social', 'Creative', 'Educational', 'Actionable'];

const CATEGORY_ICONS: IconRowItem[] = [
  { icon: 'search',         label: 'Search'    },
  { icon: 'plus',           label: 'Post'      },
  { icon: 'profile',        label: 'Members'   },
  { icon: 'store',          label: 'Goods'     },
  { icon: 'briefcase',      label: 'Work'      },
  { icon: 'graduation-cap', label: 'Learn'     },
  { icon: 'book',           label: 'Library'   },
  { icon: 'sparkle',        label: 'Events'    },
  { icon: 'location',       label: 'Places'    },
  { icon: 'palette',        label: 'Creative'  },
];

export default function Community() {
  const [filter, setFilter] = useState('All');

  return (
    <div className="cmty">
      <header className="cmty__head">
        <p className="cmty__crumb">
          <Icon name="profile" size={11} />
          <span>{'Mycelium · You\u2019re a member'}</span>
        </p>
        <h1 className="cmty__title">{MONS_SANA.name}</h1>
        <p className="cmty__sub">{MONS_SANA.description}</p>
        <div className="cmty__meta">
          <span className="cmty__meta-item">
            <span className="cmty__meta-n">{MONS_SANA.members}</span> members
          </span>
          <span className="cmty__meta-sep" aria-hidden="true">·</span>
          <span className="cmty__meta-item">
            <span className="cmty__meta-n">3</span> new this week
          </span>
        </div>
      </header>

      <FilterRow options={FILTERS} value={filter} onChange={setFilter} />

      <IconRow items={CATEGORY_ICONS} />

      <section className="cmty__feed">
        {COMMUNITY_FEED.map((c, i) => (
          <CommunityCard key={i} {...c} />
        ))}
      </section>

      <footer className="cmty__end">
        <span className="eyebrow">Quiet here for now</span>
        <Icon name="sparkle" size={14} />
      </footer>
    </div>
  );
}
