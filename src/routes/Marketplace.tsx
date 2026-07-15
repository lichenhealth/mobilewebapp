import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon, IconName } from '../components/Icon';
import FeedCard from '../components/FeedCard';
import type { MyceliumSignals } from '../components/EngagementFooter';
import { useAuth } from '../auth/AuthProvider';
import { ensureDirectChat } from '../lib/chatApi';
import { loadMySaved, setSaved } from '../lib/savedApi';
import { setHidden } from '../lib/hiddenApi';
import { loadFeed, deletePost, postAreas, type FeedPost } from '../lib/postsApi';
import { postToCard } from '../lib/feedMapping';
import {
  loadMyWeb, loadMyRecommendations, loadEndorsements, setTrust, setRecommend,
} from '../lib/myceliumApi';
import './Marketplace.css';

// Offer modes as stored by Compose: details.mode (marketplace listings) with
// event_mode as the fallback for event cross-posts.
type Mode = 'gift' | 'trade' | 'rent' | 'lend' | 'borrow' | 'sale' | 'sliding' | 'iso';
// Lend & Borrow are two sides of one exchange — one chip shows both (the
// card eyebrows tell you which side each post is). ISO = in-search-of asks.
type Chip = 'gift' | 'trade' | 'rent' | 'lendborrow' | 'iso' | 'sliding' | 'sale';
const CHIP_MODES: Record<Chip, Mode[]> = {
  gift: ['gift'], trade: ['trade'], rent: ['rent'],
  lendborrow: ['lend', 'borrow'], iso: ['iso'], sliding: ['sliding'], sale: ['sale'],
};
const MODES: { chip: Chip; label: string; icon: IconName }[] = [
  { chip: 'gift',       label: 'Gift',          icon: 'heart-line' },
  { chip: 'trade',      label: 'Trade',         icon: 'trade' },
  { chip: 'rent',       label: 'Rent',          icon: 'rent' },
  { chip: 'lendborrow', label: 'Lend & Borrow', icon: 'lend' },
  { chip: 'iso',        label: 'ISO',           icon: 'search' },
  { chip: 'sliding',    label: 'Sliding',       icon: 'sliders' },
  { chip: 'sale',       label: 'Sale',          icon: 'store' },
];

const ALL_MODES: Mode[] = ['gift', 'trade', 'rent', 'lend', 'borrow', 'sale', 'sliding', 'iso'];
function postMode(p: FeedPost): Mode | null {
  const m = p.details?.mode;
  if (typeof m === 'string' && ALL_MODES.includes(m as Mode)) return m as Mode;
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
  const [mySaves, setMySaves] = useState<Set<string>>(new Set());
  const [overlays, setOverlays] = useState<Record<string, MyceliumSignals>>({});
  const [activeChips, setActiveChips] = useState<Chip[]>([]);
  const [showSearch, setShowSearch] = useState(false);
  const [query, setQuery] = useState('');

  useEffect(() => {
    let live = true;
    (async () => {
      const feed = (await loadFeed(200)).filter((p) => postAreas(p).includes('marketplace'));
      const [{ vouched: myc }, recs, saves] = await Promise.all([loadMyWeb(), loadMyRecommendations(), loadMySaved()]);
      const ov = await loadEndorsements(feed, myc);
      if (!live) return;
      setMyMyc(myc); setMyRecs(recs); setMySaves(saves); setOverlays(ov); setPosts(feed); setReady(true);
    })();
    return () => { live = false; };
  }, []);

  const filtered = useMemo(() => {
    let list = posts;
    if (activeChips.length) {
      const wanted = new Set(activeChips.flatMap((c) => CHIP_MODES[c]));
      list = list.filter((p) => {
        const m = postMode(p);
        return m != null && wanted.has(m);
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
  }, [posts, activeChips, query]);

  const toggleChip = (c: Chip) =>
    setActiveChips((cur) => (cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c]));

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
            key={m.chip}
            className={'mkt__action' + (activeChips.includes(m.chip) ? ' is-active' : '')}
            onClick={() => toggleChip(m.chip)}
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
            saved={mySaves.has('post:' + p.id)}
            onSave={(on) => { void setSaved('post', p.id, on).catch(console.error); }}
            viewerIsAuthor={p.author_id === me}
            onManage={p.linked_event_id ? () => navigate(`/events/${p.id}`) : undefined}
            onEdit={!p.linked_event_id ? () => navigate(`/compose?post=${p.id}`) : undefined}
            onDelete={!p.linked_event_id ? () => { void deletePost(p.id).then(() => setPosts((cur) => cur.filter((x) => x.id !== p.id))).catch(console.error); } : undefined}
            onHide={me ? () => { void setHidden(p.id, true).then(() => setPosts((cur) => cur.filter((x) => x.id !== p.id))).catch(console.error); } : undefined}
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
