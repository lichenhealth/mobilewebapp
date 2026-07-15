import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon';
import FeedCard from '../components/FeedCard';
import FilterRow from '../components/FilterRow';
import type { MyceliumSignals } from '../components/EngagementFooter';
import { useAuth } from '../auth/AuthProvider';
import { ensureDirectChat } from '../lib/chatApi';
import { postAreas, deletePost, CONTENT_TYPES, SERVICE_AREAS, type FeedPost, type ServiceArea } from '../lib/postsApi';
import { postToCard } from '../lib/feedMapping';
import {
  loadMyWeb, loadMyRecommendations, loadEndorsements, setTrust, setRecommend,
} from '../lib/myceliumApi';
import { loadSavedPosts, setSaved } from '../lib/savedApi';
import { setHidden } from '../lib/hiddenApi';
import './Mycelium.css';   // shares the myc__ lens vocabulary

const CONTENT_FILTERS = ['All', ...CONTENT_TYPES.map((c) => c.label)];

/** Saved — your private shelf. Everything you bookmarked, newest first,
 *  under the platform's standard lenses. Nobody else can see it. */
export default function Saved() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const me = user?.id ?? '';

  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [ready, setReady] = useState(false);
  const [myMyc, setMyMyc] = useState<Set<string>>(new Set());
  const [myRecs, setMyRecs] = useState<Set<string>>(new Set());
  const [overlays, setOverlays] = useState<Record<string, MyceliumSignals>>({});
  // Unsaving keeps the card mounted this visit (no jumpy list); it's gone next time.
  const [unsaved, setUnsaved] = useState<Set<string>>(new Set());
  const [content, setContent] = useState('All');
  const [areas, setAreas] = useState<ServiceArea[]>([]);

  useEffect(() => {
    let live = true;
    (async () => {
      const shelf = await loadSavedPosts();
      const [{ vouched: myc }, recs] = await Promise.all([loadMyWeb(), loadMyRecommendations()]);
      const ov = await loadEndorsements(shelf, myc);
      if (!live) return;
      setMyMyc(myc); setMyRecs(recs); setOverlays(ov); setPosts(shelf); setReady(true);
    })();
    return () => { live = false; };
  }, [me]);

  // Only offer toggles for areas actually on the shelf.
  const areasPresent = useMemo(() => {
    const present = new Set<ServiceArea>();
    posts.forEach((p) => postAreas(p).forEach((a) => present.add(a)));
    return SERVICE_AREAS.filter((a) => present.has(a.value));
  }, [posts]);

  const toggleArea = (a: ServiceArea) =>
    setAreas((cur) => (cur.includes(a) ? cur.filter((x) => x !== a) : [...cur, a]));

  const visible = useMemo(() => {
    const type = CONTENT_TYPES.find((t) => t.label === content)?.value;
    return posts
      .filter((p) => (content === 'All' || p.content_type === type))
      .filter((p) => (areas.length === 0 || postAreas(p).some((a) => areas.includes(a))));
  }, [posts, content, areas]);

  async function messageAuthor(otherId: string) {
    try { navigate(`/chat/${await ensureDirectChat(otherId)}`); }
    catch (e) { console.error(e); }
  }

  return (
    <div className="myc">
      <header className="myc__head">
        <p className="myc__crumb">
          <Icon name="bookmark" size={11} />
          <span>Saved</span>
        </p>
        <h1 className="myc__title">Your shelf</h1>
        <p className="myc__sub">
          Things you wanted to come back to — kept quietly in one place, visible only to you.
        </p>
      </header>

      {posts.length > 0 && <FilterRow options={CONTENT_FILTERS} value={content} onChange={setContent} />}

      {areasPresent.length > 1 && (
        <div className="myc__areas h-scroll" role="toolbar" aria-label="Service areas">
          {areasPresent.map((a) => {
            const on = areas.includes(a.value);
            return (
              <button
                key={a.value}
                className={'myc__area' + (on ? ' is-on' : '')}
                onClick={() => toggleArea(a.value)}
                aria-pressed={on}
                aria-label={a.label}
                title={a.label}
              >
                <Icon name={a.icon} size={18} />
              </button>
            );
          })}
        </div>
      )}

      {posts.length > 0 && (
        <p className="myc__count">
          <span className="myc__count-n">{visible.length}</span>{' '}
          {visible.length === 1 ? 'saved item' : 'saved items'}
        </p>
      )}

      <section className="myc__feed">
        {!ready && <p className="myc__sub">Loading…</p>}
        {ready && posts.length === 0 && (
          <div className="myc__empty">
            <span className="display-italic">Nothing saved yet.</span>
            <p>Tap the bookmark on any post — a listing, an event, a course — and it lands here.</p>
          </div>
        )}
        {ready && posts.length > 0 && visible.length === 0 && (
          <div className="myc__empty">
            <span className="display-italic">Nothing matches.</span>
            <p>Clear a filter to see the rest of your shelf.</p>
          </div>
        )}
        {visible.map((p) => (
          <FeedCard
            key={p.id}
            {...postToCard(p, me || undefined)}
            trusted={myMyc.has('profile:' + p.author_id)}
            recommended={myRecs.has('post:' + p.id)}
            saved={!unsaved.has(p.id)}
            mycelium={overlays[p.id]}
            availability={{ trust: !!me && p.author_id !== me }}
            onTrust={(on) => { void setTrust('profile', p.author_id, on).catch(console.error); }}
            onRecommend={(on) => { void setRecommend('post', p.id, on).catch(console.error); }}
            viewerIsAuthor={p.author_id === me}
            onManage={p.linked_event_id ? () => navigate(`/events/${p.id}`) : undefined}
            onEdit={!p.linked_event_id ? () => navigate(`/compose?post=${p.id}`) : undefined}
            onDelete={!p.linked_event_id ? () => { void deletePost(p.id).then(() => setPosts((cur) => cur.filter((x) => x.id !== p.id))).catch(console.error); } : undefined}
            onHide={me ? () => { void setHidden(p.id, true).then(() => setPosts((cur) => cur.filter((x) => x.id !== p.id))).catch(console.error); } : undefined}
            onSave={(on) => {
              setUnsaved((cur) => { const n = new Set(cur); on ? n.delete(p.id) : n.add(p.id); return n; });
              void setSaved('post', p.id, on).catch(console.error);
            }}
            onMessage={me && p.author_id !== me ? () => messageAuthor(p.author_id) : undefined}
            onOpen={p.linked_event_id ? () => navigate(`/events/${p.id}`) : undefined}
            onAuthor={() => navigate(p.author_space_id ? `/spaces/${p.author_space_id}` : `/members/${p.author_id}`)}
          />
        ))}
      </section>
    </div>
  );
}
