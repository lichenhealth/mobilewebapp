import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon, IconName } from '../components/Icon';
import FeedCard from '../components/FeedCard';
import type { MyceliumSignals } from '../components/EngagementFooter';
import { useAuth } from '../auth/AuthProvider';
import { ensureDirectChat } from '../lib/chatApi';
import { loadFeed, postAreas, type FeedPost } from '../lib/postsApi';
import { postToCard } from '../lib/feedMapping';
import {
  loadMyWeb, loadMyRecommendations, loadEndorsements, setTrust, setRecommend,
} from '../lib/myceliumApi';
import './Marketplace.css';

// Offer modes as stored by Compose: details.mode (marketplace listings) with
// event_mode as the fallback for event cross-posts.
type Mode = 'gift' | 'trade' | 'rent' | 'lend' | 'borrow' | 'sale' | 'sliding';
const MODES: { mode: Mode; label: string; icon: IconName }[] = [
  { mode: 'gift',    label: 'Gift',    icon: 'heart-line' },
  { mode: 'trade',   label: 'Trade',   icon: 'trade' },
  { mode: 'rent',    label: 'Rent',    icon: 'rent' },
  { mode: 'lend',    label: 'Lend',    icon: 'lend' },
  { mode: 'borrow',  label: 'Borrow',  icon: 'lend' },
  { mode: 'sliding', label: 'Sliding', icon: 'sliders' },
  { mode: 'sale',    label: 'Sale',    icon: 'store' },
];

function postMode(p: FeedPost): Mode | null {
  const m = p.details?.mode;
  if (typeof m === 'string' && MODES.some((x) => x.mode === m)) return m as Mode;
  if (p.event_mode === 'free') return 'gift';
  if (p.event_mode === 'trade') return 'trade';
  if (p.event_mode === 'paid') return 'sale';
  return null;
}

/** The real Marketplace: every post shared to the marketplace area, under the
 *  same trust lens as every other feed. Offers and asks alike — Gift, Trade,
 *  Rent, Lend, Borrow, Sale — filtered by mode, searchable, one tap from
 *  listing anything via Compose. */
export default function Marketplace() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const me = user?.id ?? '';

  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [ready, setReady] = useState(false);
  const [myMyc, setMyMyc] = useState<Set<string>>(new Set());
  const [myRecs, setMyRecs] = useState<Set<string>>(new Set());
  const [overlays, setOverlays] = useState<Record<string, MyceliumSignals>>({});
  const [activeModes, setActiveModes] = useState<Mode[]>([]);
  const [showSearch, setShowSearch] = useState(false);
  const [query, setQuery] = useState('');

  useEffect(() => {
    let live = true;
    (async () => {
      const feed = (await loadFeed(200)).filter((p) => postAreas(p).includes('marketplace'));
      const [{ vouched: myc }, recs] = await Promise.all([loadMyWeb(), loadMyRecommendations()]);
      const ov = await loadEndorsements(feed, myc);
      if (!live) return;
      setMyMyc(myc); setMyRecs(recs); setOverlays(ov); setPosts(feed); setReady(true);
    })();
    return () => { live = false; };
  }, []);

  const filtered = useMemo(() => {
    let list = posts;
    if (activeModes.length) {
      list = list.filter((p) => {
        const m = postMode(p);
        return m != null && activeModes.includes(m);
      });
    }
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter((p) =>
        (p.title ?? '').toLowerCase().includes(q)
        || p.body.toLowerCase().includes(q)
        || (p.author?.full_name ?? '').toLowerCase().includes(q)
        || (p.author_space?.name ?? '').toLowerCase().includes(q));
    }
    return list;
  }, [posts, activeModes, query]);

  const toggleMode = (m: Mode) =>
    setActiveModes((cur) => (cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m]));

  async function messageAuthor(authorId: string) {
    try { navigate(`/chat/${await ensureDirectChat(authorId)}`); }
    catch (e) { console.error(e); }
  }

  return (
    <div className="mkt">
      <header className="mkt__head">
        <p className="mkt__crumb">
          <Icon name="store" size={11} />
          <span>Marketplace</span>
        </p>
        <h1 className="mkt__title">
          What members are <span className="display-italic">offering &amp; seeking.</span>
        </h1>
        <p className="mkt__sub">
          Goods, services, and things people are looking for.
          Trust the trader, not the platform.
        </p>
      </header>

      {/* Action chips: search & list something, then the offer-mode filters */}
      <div className="mkt__actions h-scroll">
        <button
          className={'mkt__action' + (showSearch ? ' is-active' : '')}
          onClick={() => { setShowSearch((s) => !s); if (showSearch) setQuery(''); }}
        >
          <span className="mkt__action-circle"><Icon name="search" size={14} /></span>
          <span className="mkt__action-label">Search</span>
        </button>
        <button className="mkt__action" onClick={() => navigate('/compose?area=marketplace')}>
          <span className="mkt__action-circle"><Icon name="plus" size={14} /></span>
          <span className="mkt__action-label">List</span>
        </button>
        <div className="mkt__action-spacer" />
        {MODES.map((m) => (
          <button
            key={m.mode}
            className={'mkt__action' + (activeModes.includes(m.mode) ? ' is-active' : '')}
            onClick={() => toggleMode(m.mode)}
          >
            <span className="mkt__action-circle"><Icon name={m.icon} size={14} /></span>
            <span className="mkt__action-label">{m.label}</span>
          </button>
        ))}
      </div>

      {showSearch && (
        <div className="mkt__search">
          <Icon name="search" size={14} />
          <input
            autoFocus
            className="mkt__search-input"
            placeholder="Search listings — or use smart search for distance & trust"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button className="mkt__search-smartlink" onClick={() => navigate('/search?area=marketplace')}>
            <Icon name="sliders" size={12} /> Smart
          </button>
          {query && (
            <button className="mkt__search-clear" onClick={() => setQuery('')} aria-label="Clear">
              <Icon name="close" size={12} />
            </button>
          )}
        </div>
      )}

      <p className="mkt__count">
        <span className="mkt__count-n">{filtered.length}</span>{' '}
        {filtered.length === 1 ? 'listing' : 'listings'}
      </p>

      <section className="mkt__list">
        {!ready && <p className="mkt__empty-sub">Loading…</p>}
        {ready && filtered.length === 0 && (
          <div className="mkt__empty">
            <Icon name="store" size={20} />
            <p><span className="display-italic">Nothing here yet.</span></p>
            <p className="mkt__empty-sub">
              {posts.length === 0
                ? 'Be the first — tap List and offer something to the network.'
                : 'Try clearing a filter or searching differently.'}
            </p>
          </div>
        )}
        {filtered.map((p) => (
          <FeedCard
            key={p.id}
            {...postToCard(p, me || undefined)}
            trusted={myMyc.has('profile:' + p.author_id)}
            recommended={myRecs.has('post:' + p.id)}
            mycelium={overlays[p.id]}
            availability={{ trust: !!me && p.author_id !== me }}
            onTrust={(on) => { void setTrust('profile', p.author_id, on).catch(console.error); }}
            onRecommend={(on) => { void setRecommend('post', p.id, on).catch(console.error); }}
            onMessage={me && p.author_id !== me ? () => messageAuthor(p.author_id) : undefined}
            onOpen={p.linked_event_id ? () => navigate(`/events/${p.id}`) : undefined}
            onAuthor={() => navigate(p.author_space_id ? `/spaces/${p.author_space_id}` : `/members/${p.author_id}`)}
          />
        ))}
      </section>

      <footer className="mkt__end">
        <span className="eyebrow">End of market</span>
        <Icon name="sparkle" size={14} />
      </footer>
    </div>
  );
}
