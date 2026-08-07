import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon';
import FeedCard from '../components/FeedCard';
import type { MyceliumSignals } from '../components/EngagementFooter';
import { useAuth } from '../auth/AuthProvider';
import { ensureDirectChat } from '../lib/chatApi';
import { postAreas, deletePost, SERVICE_AREAS, type FeedPost, type ServiceArea } from '../lib/postsApi';
import { postOpenPath, postToCard, weaveProps } from '../lib/feedMapping';
import {
  loadMyWeb, loadMyRecommendations, loadEndorsements, setTrust, setRecommend,
} from '../lib/myceliumApi';
import { loadSavedPosts, setSaved } from '../lib/savedApi';
import { listMyCollections, createCollection, type CollectionRow } from '../lib/collectionsApi';
import { useCollect } from '../collections/CollectPrompt';
import { setHidden } from '../lib/hiddenApi';
import './Mycelium.css';   // shares the myc__ lens vocabulary
import './Marketplace.css'; // mkt__action circle-icon vocabulary
import './Saved.css';
import AssistantDoor from '../components/AssistantDoor';
import { loadSpaceNames } from '../lib/postsApi';

// ALL / SOCIAL / ACTIONABLE RETIRED (founder 2026-08-07). The shelf keeps the
// lenses that describe what's actually on it — the area circles, present-only —
// and drops the abstract pair. content_type stays in the database.

/** Saved — your private shelf. Everything you bookmarked, newest first,
 *  under the platform's standard lenses. Nobody else can see it. */
export default function Saved() {
  const navigate = useNavigate();
  const { promptSaved, openPicker } = useCollect();
  const { user } = useAuth();
  const me = user?.id ?? '';

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
  const [ready, setReady] = useState(false);
  const [myWebSet, setMyWebSet] = useState<Set<string>>(new Set());
  const [myMyc, setMyMyc] = useState<Set<string>>(new Set());
  const [myRecs, setMyRecs] = useState<Set<string>>(new Set());
  const [overlays, setOverlays] = useState<Record<string, MyceliumSignals>>({});
  // Unsaving keeps the card mounted this visit (no jumpy list); it's gone next time.
  const [unsaved, setUnsaved] = useState<Set<string>>(new Set());
  // Folders (collections): strip up top, add-to picker per card.
  const [collections, setCollections] = useState<CollectionRow[]>([]);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  // What the inline input creates: a plain folder, or an ORDERED collection
  // ('path' kind — Organize) that opens ready to arrange.
  const [newKind, setNewKind] = useState<'collection' | 'path'>('collection');

  const [areas, setAreas] = useState<ServiceArea[]>([]);

  useEffect(() => {
    let live = true;
    (async () => {
      const shelf = await loadSavedPosts();
      const [{ web, vouched: myc }, recs, cols] = await Promise.all([loadMyWeb(), loadMyRecommendations(), listMyCollections()]);
      const ov = await loadEndorsements(shelf, myc);
      if (!live) return;
      setMyWebSet(web); setMyMyc(myc); setMyRecs(recs); setCollections(cols); setOverlays(ov); setPosts(shelf); setReady(true);
    })();
    return () => { live = false; };
  }, [me]);

  // Only offer toggles for areas actually on the shelf.
  const areasPresent = useMemo(() => {
    const present = new Set<ServiceArea>();
    posts.forEach((p) => postAreas(p).forEach((a) => present.add(a)));
    return SERVICE_AREAS.filter((a) => present.has(a.value));
  }, [posts]);

  // Your shelf gets its own doors (founder 2026-07-28): search what you kept,
  // and post something new that lands here as well as wherever you send it.
  const [showSearch, setShowSearch] = useState(false);
  const [query, setQuery] = useState('');
  // The shelf grows folders fast (founder 2026-07-30): + and Search live as
  // left circle icons (the platform vocabulary; + chooses item-or-folder),
  // and folders move into a searchable, alphabetical dropdown on the right.
  const [addOpen, setAddOpen] = useState(false);
  const [foldersOpen, setFoldersOpen] = useState(false);
  const [folderQ, setFolderQ] = useState('');
  const folderList = useMemo(() => {
    const q = folderQ.trim().toLowerCase();
    return [...collections]
      .sort((a, b) => a.name.localeCompare(b.name))
      .filter((c) => !q || c.name.toLowerCase().includes(q));
  }, [collections, folderQ]);

  const toggleArea = (a: ServiceArea) =>
    setAreas((cur) => (cur.includes(a) ? cur.filter((x) => x !== a) : [...cur, a]));

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return posts
      .filter((p) => (areas.length === 0 || postAreas(p).some((a) => areas.includes(a))))
      .filter((p) => !q
        || `${p.title ?? ''} ${p.body} ${p.author?.full_name ?? ''} ${p.author_space?.name ?? ''}`
          .toLowerCase().includes(q));
  }, [posts, areas, query]);

  async function makeFolder() {
    const nm = newFolderName.trim();
    if (!nm) return;
    try {
      const id = await createCollection(nm, newKind);
      if (newKind === 'path') { navigate(`/collections/${id}`); return; }
      setCollections(await listMyCollections());
      setNewFolderOpen(false); setNewFolderName('');
    } catch (e) { console.error(e); }
  }

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

      {/* Shelf bar (founder 2026-07-30): circle icons left — Search, and a +
          that chooses item-or-folder — with a searchable, alphabetical
          folders dropdown on the right. Chips retire; folders scale. */}
      {me && (
        <div className="saved__bar">
          <button
            className={'mkt__action' + (showSearch ? ' is-active' : '')}
            aria-label="Search" title="Search"
            onClick={() => { setShowSearch((s) => !s); if (showSearch) setQuery(''); }}
          >
            <span className="mkt__action-circle"><Icon name="search" size={14} /></span>
          </button>
          <div className="saved__add">
            <button className="mkt__action" aria-label="Add" title="Add"
              onClick={() => { setAddOpen((v) => !v); setFoldersOpen(false); }}>
              <span className="mkt__action-circle"><Icon name="plus" size={14} /></span>
            </button>
            {addOpen && (
              <div className="saved__chooser">
                <button onClick={() => { setAddOpen(false); navigate('/compose?save=1'); }}>
                  Post something<span>lands on your shelf too</span>
                </button>
                <button onClick={() => { setAddOpen(false); setNewKind('collection'); setNewFolderOpen(true); }}>
                  New folder<span>a private place to keep things</span>
                </button>
                <button onClick={() => { setAddOpen(false); navigate('/organize'); }}>
                  Organize studio<span>arrange folders &amp; collections</span>
                </button>
              </div>
            )}
          </div>
          <AssistantDoor section="saved" size={30} label="Your assistant — what you've been keeping" />
          <span className="saved__bar-spacer" />
          <div className="saved__folders">
            <button className="saved__folders-btn"
              onClick={() => { setFoldersOpen((v) => !v); setAddOpen(false); setFolderQ(''); }}>
              <Icon name="bookmark" size={13} />
              Folders{collections.length > 0 ? ` · ${collections.length}` : ''}
              <span className="saved__folders-caret">▾</span>
            </button>
            {foldersOpen && (
              <div className="saved__folders-menu">
                <input
                  autoFocus
                  value={folderQ}
                  onChange={(e) => setFolderQ(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Escape') setFoldersOpen(false); }}
                  placeholder="Find a folder…"
                />
                {folderList.map((c) => (
                  <button key={c.id} className="saved__folders-row"
                    onClick={() => { setFoldersOpen(false); navigate(`/collections/${c.id}`); }}>
                    <Icon name={c.is_public ? 'book' : 'bookmark'} size={13} />
                    <span className="saved__folders-name">{c.name}</span>
                    <span className="saved__folders-count">{c.item_count}</span>
                  </button>
                ))}
                {folderList.length === 0 && (
                  <p className="saved__folders-empty">
                    {collections.length === 0 ? 'No folders yet — the + makes one.' : 'Nothing matches.'}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {newFolderOpen && (
        <span className="saved__newfolder">
          <input
            autoFocus
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void makeFolder(); if (e.key === 'Escape') setNewFolderOpen(false); }}
            placeholder={newKind === 'path' ? 'Name your collection…' : 'Folder name'}
          />
          <button onClick={() => void makeFolder()} disabled={!newFolderName.trim()}>Create</button>
        </span>
      )}

      {showSearch && (
        <input
          className="saved__search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search what you've kept…"
          autoFocus
        />
      )}

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
            {...postToCard(p, me || undefined, spaceNames)}
            {...weaveProps(p, myWebSet, me || undefined)}
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
              void setSaved('post', p.id, on).then(() => { if (on) promptSaved(p.id); }).catch(console.error);
            }}
            extraMenuItems={[{
              label: 'Add to collection…',
              hint: collections.length ? undefined : 'Create your first folder above',
              onClick: () => openPicker(p.id),
            }]}
            onMessage={me && p.author_id !== me ? () => messageAuthor(p.author_id) : undefined}
            onOpen={() => navigate(postOpenPath(p))}
            onAuthor={() => navigate(p.author_space_id ? `/spaces/${p.author_space_id}` : `/members/${p.author_id}`)}
          />
        ))}
      </section>

    </div>
  );
}
