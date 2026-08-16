import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon';
import FeedCard from '../components/FeedCard';
import FilterRow from '../components/FilterRow';
import type { MyceliumSignals } from '../components/EngagementFooter';
import { useAuth } from '../auth/AuthProvider';
import { ensureDirectChat } from '../lib/chatApi';
import { postAreas, deletePost, loadAuthorFeed, SERVICE_AREAS, type FeedPost, type ServiceArea } from '../lib/postsApi';
import { postOpenPath, postToCard, weaveProps } from '../lib/feedMapping';
import {
  loadMyWeb, loadMyRecommendations, loadEndorsements, setTrust, setRecommend,
} from '../lib/myceliumApi';
import { loadSavedPostsTimed, setSaved } from '../lib/savedApi';
import { listMyCollections, createCollection, type CollectionRow } from '../lib/collectionsApi';
import { useCollect } from '../collections/CollectPrompt';
import { setHidden } from '../lib/hiddenApi';
import './Mycelium.css';   // shares the myc__ lens vocabulary
import './Marketplace.css'; // mkt__action circle-icon vocabulary
import './Saved.css';
import AssistantDoor from '../components/AssistantDoor';
import { loadSpaceNames } from '../lib/postsApi';

// DRIVE (founder 2026-08-14): "saving something is different than having it
// in a drive." The section holds BOTH what you saved and what you created —
// one chronological feed, publishable out from here. The save GESTURE stays
// "save" (you save TO Drive); only the place renamed. Word toggles below the
// icon row: All / Saved / Created — the room's own vocabulary, replacing the
// retired Social/Actionable pair.

const DRIVE_LENSES = ['All', 'Saved', 'Created'];

/** Drive — your private repository. What you kept and what you made, newest
 *  first, under the platform's standard lenses. Nobody else can see it. */
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
  const [lens, setLens] = useState('All');
  // When each save happened — Drive's chronology sorts saves by the save.
  const [savedAt, setSavedAt] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    let live = true;
    (async () => {
      const [shelf, created] = await Promise.all([
        loadSavedPostsTimed(),
        me ? loadAuthorFeed({ profileId: me }) : Promise.resolve([] as FeedPost[]),
      ]);
      // One entry per post: your own creations lead with their creation date,
      // saves with their save date; a post that's both counts as created
      // (it's yours) but still answers the Saved lens.
      const times = new Map(shelf.map((x) => [x.post.id, x.savedAt]));
      const byId = new Map<string, FeedPost>();
      for (const p of created) byId.set(p.id, p);
      for (const x of shelf) if (!byId.has(x.post.id)) byId.set(x.post.id, x.post);
      const merged = [...byId.values()].sort((a, b) => {
        const ta = a.author_id === me ? a.created_at : (times.get(a.id) ?? a.created_at);
        const tb = b.author_id === me ? b.created_at : (times.get(b.id) ?? b.created_at);
        return tb.localeCompare(ta);
      });
      const [{ web, vouched: myc }, recs, cols] = await Promise.all([loadMyWeb(), loadMyRecommendations(), listMyCollections()]);
      const ov = await loadEndorsements(merged, myc);
      if (!live) return;
      setSavedAt(times);
      setMyWebSet(web); setMyMyc(myc); setMyRecs(recs); setCollections(cols); setOverlays(ov); setPosts(merged); setReady(true);
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
      .filter((p) => lens === 'All'
        || (lens === 'Saved' ? savedAt.has(p.id) : p.author_id === me))
      .filter((p) => (areas.length === 0 || postAreas(p).some((a) => areas.includes(a))))
      .filter((p) => !q
        || `${p.title ?? ''} ${p.body} ${p.author?.full_name ?? ''} ${p.author_space?.name ?? ''}`
          .toLowerCase().includes(q));
  }, [posts, areas, query, lens, savedAt, me]);

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
        {/* No glyph here: the top bar's section mark is already the Drive
            cloud, and Drive is the one section whose crumb repeated it
            (My-celium's crumb uses sparkle, not the mycelium mark). */}
        <p className="myc__crumb">
          <span>Drive</span>
        </p>
        <h1 className="myc__title">Your Drive</h1>
        <p className="myc__sub">
          What you&rsquo;ve saved and what you&rsquo;ve created — organized for
          you to edit, develop and publish as desired.
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
            <span className="mkt__action-circle"><Icon name="search" size={16} /></span>
          </button>
          <div className="saved__add">
            <button className="mkt__action" aria-label="Add" title="Add"
              onClick={() => { setAddOpen((v) => !v); setFoldersOpen(false); }}>
              <span className="mkt__action-circle"><Icon name="plus" size={16} /></span>
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
          <AssistantDoor section="saved" size={38} label="Your assistant — what you've been keeping" />
          {/* Area lenses ride the same row as the doors (founder 2026-08-14:
              "design consistency with other rooms") — hairline between the
              acting doors and the shelf's own filters, like everywhere else. */}
          <span className="saved__bar-divider" aria-hidden="true" />
          <button className="mkt__action is-active saved__feeddoor" aria-label="Drive feed" title="Your Drive feed">
            <span className="mkt__action-circle"><Icon name="newsfeed" size={16} /></span>
          </button>
          {areasPresent.length > 1 && (
            <>
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
            </>
          )}
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

      {me && <FilterRow options={DRIVE_LENSES} value={lens} onChange={setLens} />}

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

      {posts.length > 0 && (
        <p className="myc__count">
          <span className="myc__count-n">{visible.length}</span>{' '}
          {visible.length === 1 ? 'item in your Drive' : 'items in your Drive'}
        </p>
      )}

      <section className="myc__feed">
        {!ready && <p className="myc__sub">Loading…</p>}
        {ready && posts.length === 0 && (
          <div className="myc__empty">
            <span className="display-italic">Your Drive is empty.</span>
            <p>Tap the bookmark on any post to save it here — and everything you create lands here on its own.</p>
          </div>
        )}
        {ready && posts.length > 0 && visible.length === 0 && (
          <div className="myc__empty">
            <span className="display-italic">Nothing matches.</span>
            <p>Clear a filter to see the rest of your Drive.</p>
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
