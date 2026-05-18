import FilterRow from '../components/FilterRow';
import IconRow, { IconRowItem } from '../components/IconRow';
import FeedCard from '../components/FeedCard';
import { Icon } from '../components/Icon';
import { FEED } from '../data/feed';
import './Home.css';

const FILTERS = ['All', 'Social', 'Creative', 'Educational', 'Actionable', 'Q&A'];

const CATEGORY_ICONS: IconRowItem[] = [
  { icon: 'search',         label: 'Search'      },
  { icon: 'plus',           label: 'Post'        },
  { icon: 'store',          label: 'Marketplace', to: '/market'        },
  { icon: 'briefcase',      label: 'Work',        to: '/work'          },
  { icon: 'graduation-cap', label: 'Education'   },
  { icon: 'fork-spoon',     label: 'Food'        },
  { icon: 'palette',        label: 'Creative'    },
  { icon: 'location',       label: 'Places',      to: '/places'        },
  { icon: 'health',         label: 'Health'      },
  { icon: 'book',           label: 'Library',     to: '/library'       },
  { icon: 'sparkle',        label: 'Concierge',   to: '/concierge'     },
];

export default function Home() {
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
