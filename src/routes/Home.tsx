import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import FilterRow from '../components/FilterRow';
import IconRow, { IconRowItem } from '../components/IconRow';
import FeedCard from '../components/FeedCard';
import type { MyceliumSignals } from '../components/EngagementFooter';
import { Icon } from '../components/Icon';
import { loadFeed, deletePost, type FeedPost } from '../lib/postsApi';
import { postOpenPath, postToCard, weaveProps } from '../lib/feedMapping';
import {
  loadMyWeb, loadMyRecommendations, loadEndorsements, setTrust, setRecommend,
} from '../lib/myceliumApi';
import { ensureDirectChat } from '../lib/chatApi';
import { loadMySaved, setSaved } from '../lib/savedApi';
import { useCollect } from '../collections/CollectPrompt';
import { setHidden } from '../lib/hiddenApi';
import { useAuth } from '../auth/AuthProvider';
import { useActing } from '../acting/ActingProvider';
import { supabase } from '../lib/supabase';
import './Home.css';
import { aiDoorOn } from '../components/AssistantDoor';
import { loadSpaceNames } from '../lib/postsApi';

// The choice point's vocabulary (founder 2026-07-28): every post is Social
// or Actionable — legacy creative/educational/qa read as Social.
const FILTERS = ['All', 'Social', 'Actionable'];

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
/** Whose network is awake — "your network" was ambiguous when the count is
 *  really the whole web you're part of, and misleading once you're acting as
 *  a community (founder 2026-08-06). Naming it removes both doubts. */
function awakeLine(n: number | null, where: string): string {
  if (n === null) return 'Welcome back.';
  if (n === 0) return `${where} is resting.`;
  if (n === 1) return `One in ${where} is awake.`;
  return `${NUMBER_WORDS[n] ?? n} in ${where} are awake.`;
}

const CATEGORY_ICONS: IconRowItem[] = [
  { icon: 'search',         label: 'Search',      to: '/search' },
  { icon: 'plus',           label: 'Post',        to: '/compose' },
  // Searching, posting, and thinking-with are one family (founder 2026-07-28).
  { icon: 'brain',          label: 'Assistant',   to: '/assistant?section=home',
    variant: 'icon-row__btn--ai', size: 22 },
  { icon: 'store',          label: 'Marketplace', to: '/market',   divider: true },
  { icon: 'rsvp',           label: 'Events',      to: '/events'        },
  { icon: 'briefcase',      label: 'Work',        to: '/work'          },
  { icon: 'graduation-cap', label: 'Education',   to: '/courses'       },
  { icon: 'fork-spoon',     label: 'Food',        to: '/food'          },
  { icon: 'palette',        label: 'Creative',    to: '/art'           },
  { icon: 'location',       label: 'Places',      to: '/places'        },
  { icon: 'plane',          label: 'Travel',      to: '/travel'        },
  { icon: 'book',           label: 'Library',     to: '/library'       },
  { icon: 'health',         label: 'Directory',   to: '/directory'     },
];

export default function Home() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { promptSaved, openPicker } = useCollect();

  async function messageAuthor(authorId: string, aboutPostId?: string) {
    try { navigate(`/chat/${await ensureDirectChat(authorId)}${aboutPostId ? `?about=${aboutPostId}` : ''}`); }
    catch (e) { console.error(e); alert('Could not open the chat: ' + (e instanceof Error ? e.message : String(e))); }
  }
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [spaceNames, setSpaceNames] = useState<Map<string, string>>(new Map());

  // Provenance names: the spaces these posts were routed into.
  useEffect(() => {
    const ids = posts.flatMap((p) => p.audience_space_ids ?? []);
    if (!ids.length) { setSpaceNames(new Map()); return; }
    let live = true;
    void loadSpaceNames(ids).then((m) => { if (live) setSpaceNames(m); });
    return () => { live = false; };
  }, [posts]);
  const [myWebSet, setMyWebSet] = useState<Set<string>>(new Set());
  const [myMyc, setMyMyc] = useState<Set<string>>(new Set());
  const [myRecs, setMyRecs] = useState<Set<string>>(new Set());
  const [mySaves, setMySaves] = useState<Set<string>>(new Set());
  const [overlays, setOverlays] = useState<Record<string, MyceliumSignals>>({});
  const [awake, setAwake] = useState<number | null>(null);
  const { actor } = useActing();
  // Acting as a community? Then it's THEIR people who are awake.
  const awakeWhere = actor.type === 'space' ? actor.name : 'the Lichen network';

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

      <IconRow items={CATEGORY_ICONS.map((it) => (it.label === 'Assistant'
        ? { ...it, variant: `icon-row__btn--ai${aiDoorOn('home') ? '' : ' ai-off'}` }
        : it))} />

      <section className="home__greeting">
        <p className="eyebrow">Inward &amp; interwoven</p>
        <h1 className="home__title">
          <span className="display-italic">{salutation()}</span>{' '}
          {user ? (
            // The doorway: awake+opted-in members lead your web's directory.
            <button className="display home__awake" onClick={() => navigate('/mycelium/directory?from=home')}>
              {awakeLine(awake, awakeWhere)}
              <span className="home__awake-chev" aria-hidden><Icon name="chevron-right" size={16} /></span>
            </button>
          ) : (
            <span className="display">{awakeLine(awake, awakeWhere)}</span>
          )}
        </h1>
        {/* The creed — captions the presence doorway it explains. */}
        <p className="home__creed">Presence is a gift, not a status.</p>
      </section>

      <section className="home__feed">
        {posts.map((p) => (
          <FeedCard
            key={p.id}
            {...postToCard(p, user?.id, spaceNames)}
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
            onMessage={p.author_id !== user?.id ? () => messageAuthor(p.author_id, p.id) : undefined}
            onOpen={() => navigate(postOpenPath(p))}
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
