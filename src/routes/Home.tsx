import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import FilterRow from '../components/FilterRow';
import IconRow, { IconRowItem } from '../components/IconRow';
import FeedCard from '../components/FeedCard';
import type { MyceliumSignals } from '../components/EngagementFooter';
import { Icon } from '../components/Icon';
import { FEED } from '../data/feed';
import { loadFeed, type FeedPost } from '../lib/postsApi';
import { postToCard } from '../lib/feedMapping';
import {
  loadMyMycelium, loadMyRecommendations, loadEndorsements, setTrust, setRecommend,
} from '../lib/myceliumApi';
import { ensureDirectChat } from '../lib/chatApi';
import { useAuth } from '../auth/AuthProvider';
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
  { icon: 'health',         label: 'Directory',   to: '/directory'     },
  { icon: 'book',           label: 'Library',     to: '/library'       },
];

export default function Home() {
  const { user } = useAuth();
  const navigate = useNavigate();

  async function messageAuthor(authorId: string) {
    try { navigate(`/chat/${await ensureDirectChat(authorId)}`); }
    catch (e) { console.error(e); }
  }
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [myMyc, setMyMyc] = useState<Set<string>>(new Set());
  const [myRecs, setMyRecs] = useState<Set<string>>(new Set());
  const [overlays, setOverlays] = useState<Record<string, MyceliumSignals>>({});

  useEffect(() => {
    (async () => {
      const feed = await loadFeed();
      const [myc, recs] = await Promise.all([loadMyMycelium(), loadMyRecommendations()]);
      const ov = await loadEndorsements(feed, myc);
      // Set posts last so cards mount once, with engagement state already in hand.
      setMyMyc(myc); setMyRecs(recs); setOverlays(ov); setPosts(feed);
    })();
  }, []);

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
        {posts.map((p) => (
          <FeedCard
            key={p.id}
            {...postToCard(p)}
            trusted={myMyc.has('profile:' + p.author_id)}
            recommended={myRecs.has(p.id)}
            mycelium={overlays[p.id]}
            availability={{ trust: p.author_id !== user?.id }}
            onTrust={(on) => { void setTrust('profile', p.author_id, on).catch(console.error); }}
            onRecommend={(on) => { void setRecommend(p.id, on).catch(console.error); }}
            onMessage={p.author_id !== user?.id ? () => messageAuthor(p.author_id) : undefined}
          />
        ))}
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
