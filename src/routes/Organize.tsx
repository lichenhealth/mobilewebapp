import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { useAuth } from '../auth/AuthProvider';
import { loadSavedPosts } from '../lib/savedApi';
import type { FeedPost } from '../lib/postsApi';
import {
  listMyCollections, loadCollection, createCollection,
  addToCollection, removeFromCollection, reorderItems,
  type CollectionRow,
} from '../lib/collectionsApi';
import './Organize.css';

/** The Organize studio (founder 2026-07-24): organizing means more than
 *  creating — arrange the pieces INSIDE a collection, and move pieces
 *  BETWEEN collections (and in from your Saved shelf). One quiet desk for
 *  all of it; deeper editing (description, offering details, publishing)
 *  lives on each collection's own page. */
export default function Organize() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const me = user?.id ?? '';

  const [cols, setCols] = useState<CollectionRow[]>([]);
  const [items, setItems] = useState<Record<string, FeedPost[]>>({});
  const [saved, setSaved] = useState<FeedPost[]>([]);
  const [ready, setReady] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  // which piece's Move picker is open: `${colId ?? 'saved'}:${postId}`
  const [moving, setMoving] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      const [mine, shelf] = await Promise.all([listMyCollections(), loadSavedPosts()]);
      const loaded: Record<string, FeedPost[]> = {};
      await Promise.all(mine.map(async (c) => {
        const col = await loadCollection(c.id);
        loaded[c.id] = col?.posts ?? [];
      }));
      if (!live) return;
      setCols(mine); setItems(loaded); setSaved(shelf); setReady(true);
    })();
    return () => { live = false; };
  }, [me]);

  // Saved pieces not yet filed into any collection.
  const filed = useMemo(() => {
    const s = new Set<string>();
    Object.values(items).forEach((list) => list.forEach((p) => s.add(p.id)));
    return s;
  }, [items]);
  const unfiled = useMemo(() => saved.filter((p) => !filed.has(p.id)), [saved, filed]);

  const label = (p: FeedPost) =>
    p.title || (p.body.length > 56 ? p.body.slice(0, 53) + '…' : p.body);

  async function create() {
    const nm = newName.trim();
    if (!nm || creating) return;
    setCreating(true);
    try {
      await createCollection(nm, 'path');
      setCols(await listMyCollections());
      setNewName('');
    } catch (e) { console.error(e); }
    setCreating(false);
  }

  /** Move a piece: into a collection (from Saved or another collection). */
  async function move(fromCol: string | null, post: FeedPost, toCol: string) {
    setMoving(null);
    try {
      await addToCollection(toCol, post.id);
      if (fromCol) await removeFromCollection(fromCol, post.id);
      setItems((cur) => {
        const next = { ...cur };
        if (fromCol) next[fromCol] = (next[fromCol] ?? []).filter((p) => p.id !== post.id);
        next[toCol] = [...(next[toCol] ?? []), post];
        return next;
      });
    } catch (e) { console.error(e); }
  }

  async function unfile(fromCol: string, post: FeedPost) {
    try {
      await removeFromCollection(fromCol, post.id);
      setItems((cur) => ({ ...cur, [fromCol]: (cur[fromCol] ?? []).filter((p) => p.id !== post.id) }));
    } catch (e) { console.error(e); }
  }

  function reorder(colId: string, index: number, dir: -1 | 1) {
    const list = items[colId] ?? [];
    const j = index + dir;
    if (j < 0 || j >= list.length) return;
    const next = list.slice();
    [next[index], next[j]] = [next[j], next[index]];
    setItems((cur) => ({ ...cur, [colId]: next }));
    void reorderItems(colId, next.map((p) => p.id)).catch(console.error);
  }

  /** The Move ▸ picker rows: every OTHER collection. */
  function MovePicker({ fromCol, post }: { fromCol: string | null; post: FeedPost }) {
    const targets = cols.filter((c) => c.id !== fromCol && !(items[c.id] ?? []).some((p) => p.id === post.id));
    return (
      <span className="org__picker">
        {targets.length === 0 && <em className="org__picker-none">No other collection yet</em>}
        {targets.map((c) => (
          <button key={c.id} className="org__picker-row" onClick={() => void move(fromCol, post, c.id)}>
            {c.name}
          </button>
        ))}
      </span>
    );
  }

  if (!me) return <div className="org"><p className="org__muted">Sign in to organize your shelf.</p></div>;

  return (
    <div className="org">
      <header className="org__head">
        <p className="org__crumb"><Icon name="book" size={11} /><span>Organize</span></p>
        <h1 className="org__title">Arrange your <span className="display-italic">shelf.</span></h1>
        <p className="org__sub">
          Gather saved pieces into collections, put them in order, move things
          between them. Publish a collection from its own page when it&rsquo;s ready.
        </p>
      </header>

      <div className="org__new">
        <input
          className="org__new-input"
          placeholder="Name a new collection…"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void create(); }}
        />
        <button className="btn btn-primary org__new-btn" disabled={!newName.trim() || creating} onClick={() => void create()}>
          {creating ? 'Creating…' : 'Create'}
        </button>
      </div>

      {!ready && <p className="org__muted">Loading your shelf…</p>}

      {/* Saved but unfiled — the raw material. */}
      {ready && unfiled.length > 0 && (
        <section className="org__col org__col--saved">
          <div className="org__col-head">
            <span className="org__col-name">Saved, not yet in a collection</span>
            <span className="org__col-count">{unfiled.length}</span>
          </div>
          {unfiled.map((p) => (
            <div className="org__row" key={p.id}>
              <button className="org__row-title" onClick={() => setMoving(moving === `saved:${p.id}` ? null : `saved:${p.id}`)}>
                {label(p)}
              </button>
              <button
                className={'org__act' + (moving === `saved:${p.id}` ? ' is-on' : '')}
                title="Add to a collection"
                onClick={() => setMoving(moving === `saved:${p.id}` ? null : `saved:${p.id}`)}
              >
                <Icon name="arrow-right" size={13} />
              </button>
              {moving === `saved:${p.id}` && <MovePicker fromCol={null} post={p} />}
            </div>
          ))}
        </section>
      )}

      {ready && cols.length === 0 && (
        <p className="org__muted">No collections yet — name your first one above.</p>
      )}

      {ready && cols.map((c) => {
        const list = items[c.id] ?? [];
        return (
          <section className="org__col" key={c.id}>
            <div className="org__col-head">
              <button className="org__col-name org__col-name--link" onClick={() => navigate(`/collections/${c.id}`)}>
                {c.name} <Icon name="chevron-right" size={12} />
              </button>
              <span className="org__col-count">{list.length}</span>
              <em className={'org__col-badge' + (c.is_public ? ' is-public' : '')}>
                {c.is_public ? 'Published' : 'Private'}
              </em>
            </div>
            {list.length === 0 && <p className="org__muted org__muted--in">Empty — move pieces in from above.</p>}
            {list.map((p, i) => (
              <div className="org__row" key={p.id}>
                <span className="org__row-n">{i + 1}</span>
                <button className="org__row-title" onClick={() => navigate(`/posts/${p.id}`)}>{label(p)}</button>
                <span className="org__acts">
                  <button className="org__act" disabled={i === 0} onClick={() => reorder(c.id, i, -1)} aria-label="Move up">
                    <Icon name="arrow-up" size={13} />
                  </button>
                  <button className="org__act org__act--down" disabled={i === list.length - 1} onClick={() => reorder(c.id, i, 1)} aria-label="Move down">
                    <Icon name="arrow-up" size={13} />
                  </button>
                  <button
                    className={'org__act' + (moving === `${c.id}:${p.id}` ? ' is-on' : '')}
                    title="Move to another collection"
                    onClick={() => setMoving(moving === `${c.id}:${p.id}` ? null : `${c.id}:${p.id}`)}
                  >
                    <Icon name="arrow-right" size={13} />
                  </button>
                  <button className="org__act" title="Remove from this collection (stays Saved)" onClick={() => void unfile(c.id, p)}>
                    <Icon name="close" size={12} />
                  </button>
                </span>
                {moving === `${c.id}:${p.id}` && <MovePicker fromCol={c.id} post={p} />}
              </div>
            ))}
          </section>
        );
      })}
    </div>
  );
}
