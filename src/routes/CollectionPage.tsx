import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Icon } from '../components/Icon';
import FeedCard from '../components/FeedCard';
import type { MyceliumSignals } from '../components/EngagementFooter';
import { useAuth } from '../auth/AuthProvider';
import { ensureDirectChat } from '../lib/chatApi';
import { deletePost, type FeedPost } from '../lib/postsApi';
import { postToCard } from '../lib/feedMapping';
import {
  loadMyWeb, loadMyRecommendations, loadEndorsements, setTrust, setRecommend,
} from '../lib/myceliumApi';
import { loadMySaved, setSaved } from '../lib/savedApi';
import { setHidden } from '../lib/hiddenApi';
import {
  loadCollection, updateCollection, deleteCollection, removeFromCollection,
  type CollectionRow,
} from '../lib/collectionsApi';
import { useCollect } from '../collections/CollectPrompt';
import './CollectionPage.css';

/** One collection — a private shelf folder, or a playlist/anthology published
 *  to the Lichen Library. The curator arranges; everyone else just enjoys. */
export default function CollectionPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { promptSaved, openPicker } = useCollect();
  const { user } = useAuth();
  const me = user?.id ?? '';

  const [meta, setMeta] = useState<CollectionRow | null>(null);
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [ready, setReady] = useState(false);
  const [myMyc, setMyMyc] = useState<Set<string>>(new Set());
  const [myRecs, setMyRecs] = useState<Set<string>>(new Set());
  const [mySaves, setMySaves] = useState<Set<string>>(new Set());
  const [overlays, setOverlays] = useState<Record<string, MyceliumSignals>>({});
  // owner editing
  const [editOpen, setEditOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setReady(false);
    const [col, { vouched: myc }, recs, saves] = await Promise.all([
      loadCollection(id), loadMyWeb(), loadMyRecommendations(), loadMySaved(),
    ]);
    if (!col) { setMeta(null); setReady(true); return; }
    const ov = await loadEndorsements(col.posts, myc);
    setMeta(col.meta); setPosts(col.posts);
    setName(col.meta.name); setDescription(col.meta.description ?? '');
    setMyMyc(myc); setMyRecs(recs); setMySaves(saves); setOverlays(ov);
    setReady(true);
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  const isOwner = !!me && meta?.owner_id === me;

  async function act(fn: () => Promise<void>) {
    setBusy(true); setError('');
    try { await fn(); } catch (e) { setError((e as Error)?.message || 'Something went wrong.'); }
    setBusy(false);
  }

  async function messageAuthor(otherId: string) {
    try { navigate(`/chat/${await ensureDirectChat(otherId)}`); }
    catch (e) { console.error(e); }
  }

  if (!ready) return <div className="colp"><p className="colp__muted">Loading…</p></div>;
  if (!meta) return <div className="colp"><p className="colp__muted">This page isn&rsquo;t available.</p></div>;

  return (
    <div className="colp">
      <header className="colp__head">
        <p className="colp__crumb">
          <Icon name="bookmark" size={11} />
          <span>Collection</span>
          <em className={'colp__badge' + (meta.is_public ? ' is-public' : '')}>
            {meta.is_public ? 'Published' : 'Private'}
          </em>
        </p>
        <h1 className="colp__title display-italic">{meta.name}</h1>
        <p className="colp__by">
          curated by{' '}
          <Link to={`/members/${meta.owner_id}`}>{meta.owner?.full_name ?? 'a member'}</Link>
          {' · '}{posts.length} {posts.length === 1 ? 'piece' : 'pieces'}
        </p>
        {meta.description && <p className="colp__desc">{meta.description}</p>}
      </header>

      {error && <p className="colp__error">{error}</p>}

      {isOwner && (
        <div className="colp__controls">
          <button className="btn colp__btn" onClick={() => setEditOpen((o) => !o)}>
            {editOpen ? 'Done' : 'Edit'}
          </button>
          <button
            className="btn btn-primary colp__btn"
            disabled={busy}
            onClick={() => void act(async () => {
              await updateCollection(id, { is_public: !meta.is_public });
              setMeta((m) => (m ? { ...m, is_public: !m.is_public } : m));
            })}
          >
            {meta.is_public ? 'Make private' : 'Publish to Lichen Library'}
          </button>
          <button
            className="btn colp__btn colp__btn--danger"
            disabled={busy}
            onClick={() => {
              if (window.confirm(`Delete "${meta.name}"? The posts themselves are untouched.`)) {
                void act(async () => { await deleteCollection(id); navigate('/saved'); });
              }
            }}
          >
            Delete
          </button>
        </div>
      )}

      {isOwner && editOpen && (
        <div className="colp__edit">
          <input
            className="prof__input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Collection name"
          />
          <textarea
            className="prof__textarea"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What is this collection for? (optional — shown when published)"
          />
          <button
            className="btn btn-primary colp__btn"
            disabled={busy || !name.trim()}
            onClick={() => void act(async () => {
              await updateCollection(id, { name: name.trim(), description: description.trim() || null });
              setMeta((m) => (m ? { ...m, name: name.trim(), description: description.trim() || null } : m));
              setEditOpen(false);
            })}
          >
            Save
          </button>
        </div>
      )}

      <section className="colp__list">
        {posts.length === 0 && (
          <p className="colp__muted">
            Nothing here yet{isOwner ? ' — add pieces from your Saved shelf.' : '.'}
          </p>
        )}
        {posts.map((p) => (
          <FeedCard
            key={p.id}
            {...postToCard(p, me || undefined)}
            trusted={myMyc.has('profile:' + p.author_id)}
            recommended={myRecs.has('post:' + p.id)}
            saved={mySaves.has('post:' + p.id)}
            mycelium={overlays[p.id]}
            availability={{ trust: !!me && p.author_id !== me }}
            onTrust={(on) => { void setTrust('profile', p.author_id, on).catch(console.error); }}
            onRecommend={(on) => { void setRecommend('post', p.id, on).catch(console.error); }}
            onSave={me ? (on) => { void setSaved('post', p.id, on).then(() => { if (on) promptSaved(p.id); }).catch(console.error); } : undefined}
            extraMenuItems={[
              ...(me ? [{ label: 'Add to collection…', onClick: () => openPicker(p.id) }] : []),
              ...(isOwner ? [{
                label: 'Remove from this collection',
                onClick: () => {
                  void removeFromCollection(id, p.id)
                    .then(() => setPosts((cur) => cur.filter((x) => x.id !== p.id)))
                    .catch(console.error);
                },
              }] : []),
            ]}
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
    </div>
  );
}
