import { useEffect, useState } from 'react';
import FilterRow from '../components/FilterRow';
import IconRow, { IconRowItem } from '../components/IconRow';
import FeedCard, { FeedCardProps } from '../components/FeedCard';
import { Icon } from '../components/Icon';
import { FEED } from '../data/feed';
import { loadFeed, serviceAreaIcon, type FeedPost } from '../lib/postsApi';
import './Home.css';

const FILTERS = ['All', 'Social', 'Creative', 'Educational', 'Actionable', 'Q&A'];

const CATEGORY_ICONS: IconRowItem[] = [
  { icon: 'search',         label: 'Search'      },
  { icon: 'plus',           label: 'Post',        to: '/compose' },
  { icon: 'store',          label: 'Marketplace', to: '/market',   divider: true },
  { icon: 'briefcase',      label: 'Work',        to: '/work'          },
  { icon: 'graduation-cap', label: 'Education'   },
  { icon: 'fork-spoon',     label: 'Food'        },
  { icon: 'palette',        label: 'Creative'    },
  { icon: 'location',       label: 'Places',      to: '/places'        },
  { icon: 'health',         label: 'Health'      },
  { icon: 'book',           label: 'Library',     to: '/library'       },
];

// Map a real DB post into the existing FeedCard shape.
function postToCard(p: FeedPost): FeedCardProps {
  const name = p.author?.full_name || 'Member';
  const icon = serviceAreaIcon(p.service_area);
  const title = p.title || (p.body.length > 64 ? p.body.slice(0, 61) + '…' : p.body);
  return {
    title,
    handle: '@' + (p.author?.handle || name.toLowerCase().replace(/\s+/g, '-')),
    avatarMonogram: name.charAt(0).toUpperCase(),
    body: p.body,
    categoryIcons: icon ? [icon] : [],
    eyebrow: p.visibility === 'mycelium' ? 'Mycelium' : undefined,
  };
}

export default function Home() {
  const [posts, setPosts] = useState<FeedPost[]>([]);
  useEffect(() => { loadFeed().then(setPosts); }, []);

  return (
    <div className="home">
      <FilterRow options={FILTERS} />

      <IconRow items={CATEGORY_ICONS} />

      <section className="home__greeting">
        <p className="eyebrow">Today, slow & considered</p>
        <h1 className="home__title">
          <span className="display-italic">Good morning.</span>{' '}
          <span className="display">Eight in your network are awake.</span>
        </h1>
      </section>

      <section className="home__feed">
        {/* Real posts first, then the demo feed below (until the platform fills in). */}
        {posts.map((p) => <FeedCard key={p.id} {...postToCard(p)} />)}
        {FEED.map((card, i) => (
          <FeedCard key={i} {...card} />
        ))}
      </section>

      <footer className="home__end">
        <span className="eyebrow">All caught up</span>
        <Icon name="sparkle" size={14} />
      </footer>
    </div>
  );
}
