import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon, type IconName } from '../components/Icon';
import FeedCard from '../components/FeedCard';
import FilterRow from '../components/FilterRow';
import type { MyceliumSignals } from '../components/EngagementFooter';
import { useAuth } from '../auth/AuthProvider';
import { chatPathForPost } from '../lib/chatApi';
import { postAreas, deletePost, loadAuthorFeed, serviceAreaIcon, SERVICE_AREAS, type FeedPost, type ServiceArea } from '../lib/postsApi';
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
// publishable out from here. The save GESTURE stays "save" (you save TO
// Drive); only the place renamed.
//
// THE DRIVE LAYOUT (founder 2026-10-06: "audit google drive, etc and
// re-build the layout to best act like a drive, but one that supports how
// things need to be saved and organized on lichen"): a drive's anatomy,
// Lichen's materials. FOLDERS LEAD — your collections as a tile grid (name,
// count, private/published state; a published folder IS a collection other
// people read, so the tile says so), with a + tile and an "All N" fold past
// eight. ITEMS below as compact drive ROWS by default — thumbnail-or-area-
// icon, title, provenance line ("Saved Sep 30 · from Galyn · Marketplace"),
// a ⋮ menu — grouped Today / This week / This month / Earlier by the
// DRIVE time (your own pieces by creation, saves by when you saved them).
// A Rows|Cards toggle keeps the old full-card feed one tap away
// (localStorage, a per-device convenience). Search filters folders AND
// items, a drive's one search box. The Folders dropdown retired with the
// tiles — same information, standing in the open.

const DRIVE_LENSES = ['All', 'Saved', 'Created'];

/** Which time shelf an item sits on — a drive's scannable chronology. */
function groupOf(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return 'Today';
  const days = (now.getTime() - d.getTime()) / 86400000;
  if (days < 7) return 'This week';
  if (days < 31) return 'This month';
  return 'Earlier';
}

function shortDate(iso: string): string {
  const d = new Date(iso);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' });
}

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
  // Cards view: unsaving keeps the card mounted this visit (no jumpy list).
  const [unsaved, setUnsaved] = useState<Set<string>>(new Set());
  // Folders (collections): the leading tile grid.
  const [collections, setCollections] = useState<CollectionRow[]>([]);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  // What the inline input creates: a plain folder, or an ORDERED collection
  // ('path' kind — Organize) that opens ready to arrange.
  const [newKind, setNewKind] = useState<'collection' | 'path'>('collection');
  const [folderAll, setFolderAll] = useState(false);

  const [areas, setAreas] = useState<ServiceArea[]>([]);
  const [lens, setLens] = useState('All');
  // When each save happened — Drive's chronology sorts saves by the save.
  const [savedAt, setSavedAt] = useState<Map<string, string>>(new Map());
  // Rows is the drive's own shape; Cards keeps the old feed one tap away.
  const [view, setView] = useState<'rows' | 'cards'>(() => {
    try { return localStorage.getItem('lichen.driveView') === 'cards' ? 'cards' : 'rows'; }
    catch { return 'rows'; }
  });
  const pickView = (v: 'rows' | 'cards') => {
    setView(v);
    try { localStorage.setItem('lichen.driveView', v); } catch { /* per-device nicety only */ }
  };
  // Which row's ⋮ menu is open.
  const [menuFor, setMenuFor] = useState<string | null>(null);

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

  const [showSearch, setShowSearch] = useState(false);
  const [query, setQuery] = useState('');
  const [addOpen, setAddOpen] = useState(false);

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

  // Folders answer the same search box — a drive has ONE search.
  const foldersVisible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...collections]
      .sort((a, b) => a.name.localeCompare(b.name))
      .filter((c) => !q || c.name.toLowerCase().includes(q));
  }, [collections, query]);
  const folderShelf = folderAll || query ? foldersVisible : foldersVisible.slice(0, 8);

  /** The drive time: your own pieces by creation, saves by the save. */
  const driveTime = (p: FeedPost) =>
    p.author_id === me ? p.created_at : (savedAt.get(p.id) ?? p.created_at);

  /** Rows view, grouped on the time shelves in the order they occur. */
  const grouped = useMemo(() => {
    const out: { label: string; items: FeedPost[] }[] = [];
    for (const p of visible) {
      const label = groupOf(driveTime(p));
      const last = out[out.length - 1];
      if (last && last.label === label) last.items.push(p);
      else out.push({ label, items: [p] });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, savedAt, me]);

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

  // One rule for every feed's chat door (founder 2026-08-17): a post in a
  // space's voice opens the conversation WITH that space, answered by the
  // admin who wrote it; a personal post opens the DM. The post rides along.
  async function messageAbout(post: { id: string; author_id: string; author_space_id?: string | null }) {
    try { navigate(await chatPathForPost(post)); }
    catch (e) { console.error(e); alert('Could not open the chat: ' + (e instanceof Error ? e.message : String(e))); }
  }

  /** A folder tile's icon says what the folder IS. */
  function folderIcon(c: CollectionRow): IconName {
    if (c.kind === 'course') return 'graduation-cap';
    if ((c.details as { forCourse?: string }).forCourse) return 'graduation-cap';
    if (c.kind === 'path') return 'queue';
    return c.is_public ? 'book' : 'bookmark';
  }
  function folderKindLabel(c: CollectionRow): string | null {
    if (c.kind === 'course') return 'Course';
    if ((c.details as { forCourse?: string }).forCourse) return 'Course notebook';
    if (c.kind === 'path') return 'Ordered';
    return null;
  }

  /** One compact drive row. */
  function DriveRow({ p }: { p: FeedPost }) {
    const media = Array.isArray(p.details?.media)
      ? (p.details.media as { type: string; url: string }[]) : [];
    const photo = media.find((m) => m.type === 'photo')?.url ?? p.image_url;
    const area = postAreas(p)[0] ?? null;
    const icon = serviceAreaIcon(area) ?? 'newsfeed';
    const areaLabel = area ? (SERVICE_AREAS.find((s) => s.value === area)?.label ?? null) : null;
    const own = p.author_id === me;
    const t = driveTime(p);
    const title = p.title || (p.body.length > 72 ? p.body.slice(0, 69) + '…' : p.body) || 'Untitled';
    const who = p.author_space?.name ?? p.author?.full_name ?? null;
    const menuOpen = menuFor === p.id;
    return (
      <div className="drive__row" role="button" tabIndex={0}
        onClick={() => navigate(postOpenPath(p))}
        onKeyDown={(e) => { if (e.key === 'Enter') navigate(postOpenPath(p)); }}>
        {photo
          ? <img className="drive__row-thumb" src={photo} alt="" loading="lazy" />
          : <span className="drive__row-icon"><Icon name={icon} size={16} /></span>}
        <span className="drive__row-main">
          <span className="drive__row-title">{title}</span>
          <span className="drive__row-meta">
            {own ? `Created ${shortDate(t)}` : `Saved ${shortDate(t)}`}
            {!own && who ? ` · from ${who}` : ''}
            {areaLabel ? ` · ${areaLabel}` : ''}
          </span>
        </span>
        <span className="drive__row-acts" onClick={(e) => e.stopPropagation()}>
          <button className="drive__row-more" aria-label="More" aria-expanded={menuOpen}
            onClick={() => setMenuFor(menuOpen ? null : p.id)}>
            <Icon name="more-horizontal" size={15} />
          </button>
          {menuOpen && (
            <span className="drive__menu" role="menu">
              <button onClick={() => { setMenuFor(null); navigate(postOpenPath(p)); }}>Open</button>
              <button onClick={() => { setMenuFor(null); openPicker(p.id); }}>Add to folder…</button>
              {me && !own && (
                <button onClick={() => { setMenuFor(null); void messageAbout(p); }}>Message the author</button>
              )}
              {own && p.linked_event_id && (
                <button onClick={() => { setMenuFor(null); navigate(`/events/${p.id}`); }}>Manage event</button>
              )}
              {own && !p.linked_event_id && (
                <button onClick={() => { setMenuFor(null); navigate(`/compose?post=${p.id}`); }}>Edit</button>
              )}
              {!own && savedAt.has(p.id) && (
                <button onClick={() => {
                  setMenuFor(null);
                  void setSaved('post', p.id, false)
                    .then(() => setPosts((cur) => cur.filter((x) => x.id !== p.id)))
                    .catch(console.error);
                }}>Remove from Drive</button>
              )}
              {!own && (
                <button onClick={() => {
                  setMenuFor(null);
                  void setHidden(p.id, true).then(() => setPosts((cur) => cur.filter((x) => x.id !== p.id))).catch(console.error);
                }}>Hide</button>
              )}
              {own && !p.linked_event_id && (
                <button className="drive__menu-danger" onClick={() => {
                  setMenuFor(null);
                  if (!window.confirm('Delete this post everywhere on Lichen? This can’t be undone.')) return;
                  void deletePost(p.id).then(() => setPosts((cur) => cur.filter((x) => x.id !== p.id))).catch(console.error);
                }}>Delete</button>
              )}
            </span>
          )}
        </span>
      </div>
    );
  }

  return (
    <div className="myc">
      <header className="myc__head">
        {/* No crumb at all (founder 2026-10-02: "We don't need to say 'Drive'
            above My Drive") — the top bar's section mark already names the
            room, and the title says the rest. */}
        <h1 className="myc__title">Your Drive</h1>
        <p className="myc__sub">
          What you&rsquo;ve saved and what you&rsquo;ve created — organized for
          you to edit, develop and publish as desired.
        </p>
      </header>

      {/* Doors bar: Search, + (item-or-folder), brain | hairline | the lit
          Feed door and the area lenses. The Folders dropdown retired
          2026-10-06 — folders stand in the open as tiles below. */}
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
              onClick={() => setAddOpen((v) => !v)}>
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
        </div>
      )}

      {me && <FilterRow options={DRIVE_LENSES} value={lens} onChange={setLens} />}

      {showSearch && (
        <input
          className="saved__search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search your Drive…"
          autoFocus
        />
      )}

      {/* ── FOLDERS — the drive's cabinets lead (founder 2026-10-06). A tile
          names its folder, its count, and its state: a published folder is a
          COLLECTION others can read; a course notebook says whose. ── */}
      {me && ready && (
        <section className="drive__folders">
          <p className="drive__eyebrow">Folders</p>
          <div className="drive__folder-grid">
            {folderShelf.map((c) => (
              <button key={c.id} className="drive__folder" onClick={() => navigate(`/collections/${c.id}`)}>
                <span className="drive__folder-ic"><Icon name={folderIcon(c)} size={17} /></span>
                <span className="drive__folder-body">
                  <span className="drive__folder-name">{c.name}</span>
                  <span className="drive__folder-meta">
                    {c.item_count === 1 ? '1 item' : `${c.item_count} items`}
                    {folderKindLabel(c) ? ` · ${folderKindLabel(c)}` : ''}
                    {c.is_public ? ' · Published' : ''}
                  </span>
                </span>
              </button>
            ))}
            <button className="drive__folder drive__folder--new"
              onClick={() => { setNewKind('collection'); setNewFolderOpen(true); }}>
              <span className="drive__folder-ic"><Icon name="plus" size={16} /></span>
              <span className="drive__folder-body">
                <span className="drive__folder-name">New folder</span>
                <span className="drive__folder-meta">private until you publish it</span>
              </span>
            </button>
          </div>
          {!query && foldersVisible.length > 8 && (
            <button className="drive__folders-all" onClick={() => setFolderAll((v) => !v)}>
              {folderAll ? 'Fewer folders' : `All ${foldersVisible.length} folders`}
            </button>
          )}
          {query.trim() !== '' && foldersVisible.length === 0 && (
            <p className="drive__none">No folder matches.</p>
          )}
        </section>
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

      {/* ── ITEMS — compact rows by default, the old cards a tap away. ── */}
      {me && ready && posts.length > 0 && (
        <div className="drive__items-head">
          <p className="drive__eyebrow">
            Items
            <span className="drive__count">{visible.length}</span>
          </p>
          <span className="drive__viewtoggle" role="group" aria-label="Item view">
            <button className={view === 'rows' ? 'is-on' : ''} aria-label="Rows" title="Rows"
              onClick={() => pickView('rows')}><Icon name="queue" size={14} /></button>
            <button className={view === 'cards' ? 'is-on' : ''} aria-label="Cards" title="Cards"
              onClick={() => pickView('cards')}><Icon name="grip" size={14} /></button>
          </span>
        </div>
      )}

      <section className={view === 'rows' ? 'drive__list' : 'myc__feed'}>
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
        {view === 'rows' && grouped.map((g) => (
          <div className="drive__group" key={g.label + g.items[0]?.id}>
            <p className="drive__group-label">{g.label}</p>
            {g.items.map((p) => <DriveRow key={p.id} p={p} />)}
          </div>
        ))}
        {view === 'cards' && visible.map((p) => (
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
            onMessage={me && p.author_id !== me ? () => messageAbout(p) : undefined}
            onOpen={() => navigate(postOpenPath(p))}
            onAuthor={() => navigate(p.author_space_id ? `/spaces/${p.author_space_id}` : `/members/${p.author_id}`)}
          />
        ))}
      </section>

    </div>
  );
}
