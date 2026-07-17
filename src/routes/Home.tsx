import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import FilterRow from '../components/FilterRow';
import IconRow, { IconRowItem } from '../components/IconRow';
import FeedCard from '../components/FeedCard';
import type { MyceliumSignals } from '../components/EngagementFooter';
import { Icon } from '../components/Icon';
import { loadFeed, deletePost, type FeedPost } from '../lib/postsApi';
import { postToCard, weaveProps } from '../lib/feedMapping';
import {
  loadMyWeb, loadMyRecommendations, loadEndorsements, setTrust, setRecommend,
} from '../lib/myceliumApi';
import { ensureDirectChat } from '../lib/chatApi';
import { loadMySaved, setSaved } from '../lib/savedApi';
import { useCollect } from '../collections/CollectPrompt';
import { setHidden } from '../lib/hiddenApi';
import { useAuth } from '../auth/AuthProvider';
import { supabase } from '../lib/supabase';
import './Home.css';

const FILTERS = ['All', 'Social', 'Creative', 'Educational', 'Actionable', 'Q&A'];

// The greeting tells the truth now (founder, 2026-07-16): a time-aware
// salutation + the real count of network members active in the last 12 hours.
function salutation(): string {
  const h = new Date().getHours();
  if (h >= 5 && h < 12) return 'Good morning.';
  if (h < 17) return 'Good afternoon.';
  if (h < 22) return 'Good evening.';
  return 'Good night.';
}
const NUMBER_WORDS = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six',
  'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve'];
function awakeLine(n: number | null): string {
  if (n === null) return 'Welcome back.';
  if (n === 0) return 'Your network is resting.';
  if (n === 1) return 'One in your network is awake.';
  return `${NUMBER_WORDS[n] ?? n} in your network are awake.`;
}

const CATEGORY_ICONS: IconRowItem[] = [
  { icon: 'search',         label: 'Search',      to: '/search' },
  { icon: 'plus',           label: 'Post',        to: '/compose' },
  { icon: 'store',          label: 'Marketplace', to: '/market',   divider: true },
  { icon: 'rsvp',           label: 'Events',      to: '/events'        },
  { icon: 'briefcase',      label: 'Work',        to: '/work'          },
  { icon: 'graduation-cap', label: 'Education',   to: '/courses'       },
  { icon: 'fork-spoon',     label: 'Food',        to: '/food'          },
  { icon: 'palette',        label: 'Creative',    to: '/art'           },
  { icon: 'location',       label: 'Places',      to: '/places'        },
  { icon: 'book',           label: 'Library',     to: '/library'       },
  { icon: 'health',         label: 'Directory',   to: '/directory'     },
];

export default function Home() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { promptSaved, openPicker } = useCollect();

  async function messageAuthor(authorId: string) {
    try { navigate(`/chat/${await ensureDirectChat(authorId)}`); }
    catch (e) { console.error(e); alert('Could not open the chat: ' + (e instanceof Error ? e.message : String(e))); }
  }
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [myWebSet, setMyWebSet] = useState<Set<string>>(new Set());
  const [myMyc, setMyMyc] = useState<Set<string>>(new Set());
  const [myRecs, setMyRecs] = useState<Set<string>>(new Set());
  const [mySaves, setMySaves] = useState<Set<string>>(new Set());
  const [overlays, setOverlays] = useState<Record<string, MyceliumSignals>>({});
  const [awake, setAwake] = useState<number | null>(null);

  useEffect(() => {
    (async () => {
      const feed = await loadFeed();
      const [{ web, vouched: myc }, recs, saves, awakeRes] = await Promise.all([
        loadMyWeb(), loadMyRecommendations(), loadMySaved(),
        supabase.rpc('network_awake_count'),
      ]);
      setAwake((awakeRes.data as number | null) ?? null);
      const ov = await loadEndorsements(feed, myc);
      // Set posts last so cards mount once, with engagement state already in hand.
      setMyWebSet(web); setMyMyc(myc); setMyRecs(recs); setMySaves(saves); setOverlays(ov); setPosts(feed);
    })();
  }, []);

  return (
    <div className="home">
      <FilterRow options={FILTERS} />

      <IconRow items={CATEGORY_ICONS} />

      <section className="home__greeting">
        <p className="eyebrow">Today, slow & considered</p>
        <h1 className="home__title">
          <span className="display-italic">{salutation()}</span>{' '}
          <span className="display">{awakeLine(awake)}</span>
        </h1>
      </section>

      <section className="home__feed">
        {posts.map((p) => (
          <FeedCard
            key={p.id}
            {...postToCard(p, user?.id)}
            {...weaveProps(p, myWebSet, user?.id)}
            trusted={myMyc.has('profile:' + p.author_id)}
            recommended={myRecs.has('post:' + p.id)}
            mycelium={overlays[p.id]}
            availability={{ trust: p.author_id !== user?.id }}
            onTrust={(on) => { void setTrust('profile', p.author_id, on).catch(console.error); }}
            onRecommend={(on) => { void setRecommend('post', p.id, on).catch(console.error); }}
            saved={mySaves.has('post:' + p.id)}
            onSave={(on) => { void setSaved('post', p.id, on).then(() => { if (on) promptSaved(p.id); }).catch(console.error); }}
            extraMenuItems={user ? [{ label: 'Add to collection…', onClick: () => openPicker(p.id) }] : undefined}
            viewerIsAuthor={p.author_id === user?.id}
            onManage={p.linked_event_id ? () => navigate(`/events/${p.id}`) : undefined}
            onEdit={!p.linked_event_id ? () => navigate(`/compose?post=${p.id}`) : undefined}
            onDelete={!p.linked_event_id ? () => { void deletePost(p.id).then(() => setPosts((cur) => cur.filter((x) => x.id !== p.id))).catch(console.error); } : undefined}
            onHide={user ? () => { void setHidden(p.id, true).then(() => setPosts((cur) => cur.filter((x) => x.id !== p.id))).catch(console.error); } : undefined}
            onMessage={p.author_id !== user?.id ? () => messageAuthor(p.author_id) : undefined}
            onOpen={p.linked_event_id ? () => navigate(`/events/${p.id}`) : undefined}
            onAuthor={() => navigate(p.author_space_id ? `/spaces/${p.author_space_id}` : `/members/${p.author_id}`)}
          />
        ))}
      </section>

      <footer className="home__end">
        <span className="eyebrow">All caught up</span>
        <Icon name="sparkle" size={14} />
      </footer>
    </div>
  );
}
