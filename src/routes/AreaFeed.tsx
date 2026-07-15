import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon, IconName } from '../components/Icon';
import FeedCard from '../components/FeedCard';
import type { MyceliumSignals } from '../components/EngagementFooter';
import { useAuth } from '../auth/AuthProvider';
import { ensureDirectChat } from '../lib/chatApi';
import { loadFeed, postAreas, type FeedPost, type ServiceArea } from '../lib/postsApi';
import { postToCard } from '../lib/feedMapping';
import {
  loadMyWeb, loadMyRecommendations, loadEndorsements, setTrust, setRecommend,
} from '../lib/myceliumApi';
import './Marketplace.css';   // shares the mkt__ section vocabulary

/** A real service-area section (Courses, Library, …): every post shared to
 *  the area, standard feed cards under the trust lens, its own Add + Search
 *  doors. The pattern the Marketplace proved, reusable per area. */
export default function AreaFeed({ area, icon, crumb, title, italic, sub, addLabel, emptyHint }: {
  area: ServiceArea;
  icon: IconName;
  crumb: string;
  title: string;        // leading (roman) part of the headline
  italic: string;       // display-italic tail
  sub: string;
  addLabel: string;     // the + chip label, e.g. "Offer a course"
  emptyHint: string;
}) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const me = user?.id ?? '';

  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [ready, setReady] = useState(false);
  const [myMyc, setMyMyc] = useState<Set<string>>(new Set());
  const [myRecs, setMyRecs] = useState<Set<string>>(new Set());
  const [overlays, setOverlays] = useState<Record<string, MyceliumSignals>>({});
  const [showSearch, setShowSearch] = useState(false);
  const [query, setQuery] = useState('');

  useEffect(() => {
    let live = true;
    setReady(false);
    (async () => {
      const feed = (await loadFeed(200)).filter((p) => postAreas(p).includes(area));
      const [{ vouched: myc }, recs] = await Promise.all([loadMyWeb(), loadMyRecommendations()]);
      const ov = await loadEndorsements(feed, myc);
      if (!live) return;
      setMyMyc(myc); setMyRecs(recs); setOverlays(ov); setPosts(feed); setReady(true);
    })();
    return () => { live = false; };
  }, [area]);

  const filtered = useMemo(() => {
    if (!query.trim()) return posts;
    const q = query.trim().toLowerCase();
    return posts.filter((p) =>
      (p.title ?? '').toLowerCase().includes(q)
      || p.body.toLowerCase().includes(q)
      || (p.author?.full_name ?? '').toLowerCase().includes(q)
      || (p.author_space?.name ?? '').toLowerCase().includes(q));
  }, [posts, query]);

  async function messageAuthor(authorId: string) {
    try { navigate(`/chat/${await ensureDirectChat(authorId)}`); }
    catch (e) { console.error(e); }
  }

  return (
    <div className="mkt">
      <header className="mkt__head">
        <p className="mkt__crumb">
          <Icon name={icon} size={11} />
          <span>{crumb}</span>
        </p>
        <h1 className="mkt__title">
          {title} <span className="display-italic">{italic}</span>
        </h1>
        <p className="mkt__sub">{sub}</p>
      </header>

      <div className="mkt__actions h-scroll">
        <button
          className={'mkt__action' + (showSearch ? ' is-active' : '')}
          onClick={() => { setShowSearch((s) => !s); if (showSearch) setQuery(''); }}
        >
          <span className="mkt__action-circle"><Icon name="search" size={14} /></span>
          <span className="mkt__action-label">Search</span>
        </button>
        <button className="mkt__action" onClick={() => navigate(`/compose?area=${area}`)}>
          <span className="mkt__action-circle"><Icon name="plus" size={14} /></span>
          <span className="mkt__action-label">{addLabel}</span>
        </button>
      </div>

      {showSearch && (
        <div className="mkt__search">
          <Icon name="search" size={14} />
          <input
            autoFocus
            className="mkt__search-input"
            placeholder={`Search ${crumb.toLowerCase()} — or use smart search for trust & distance`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button className="mkt__search-smartlink" onClick={() => navigate(`/search?area=${area}`)}>
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
        {filtered.length === 1 ? 'post' : 'posts'}
      </p>

      <section className="mkt__list">
        {!ready && <p className="mkt__empty-sub">Loading…</p>}
        {ready && filtered.length === 0 && (
          <div className="mkt__empty">
            <Icon name={icon} size={20} />
            <p><span className="display-italic">Nothing here yet.</span></p>
            <p className="mkt__empty-sub">{posts.length === 0 ? emptyHint : 'Try a different search.'}</p>
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
        <span className="eyebrow">{`End of ${crumb.toLowerCase()}`}</span>
        <Icon name="sparkle" size={14} />
      </footer>
    </div>
  );
}
