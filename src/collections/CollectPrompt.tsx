import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Icon } from '../components/Icon';
import {
  listMyCollections, createCollection, addToCollection, type CollectionRow,
} from '../lib/collectionsApi';
import './CollectPrompt.css';

/** The save→organize bridge (founder, 2026-07-14): Save stays one tap, but
 *  the moment you save, a toast offers "Add to collection…" — and the folder
 *  picker opens right where you are. Mounted once at the app level; every
 *  feed surface calls promptSaved() after a successful save, and any ⋯ menu
 *  can call openPicker() directly. */

interface CollectCtx {
  /** Show the after-save toast with its "Add to collection…" action. */
  promptSaved: (postId: string) => void;
  /** Open the folder picker for a post straight away. */
  openPicker: (postId: string) => void;
}

const Ctx = createContext<CollectCtx>({ promptSaved: () => {}, openPicker: () => {} });
export const useCollect = () => useContext(Ctx);

export function CollectPromptProvider({ children }: { children: React.ReactNode }) {
  const [toastFor, setToastFor] = useState<string | null>(null);
  const [toastPos, setToastPos] = useState<{ x: number; y: number } | null>(null);
  // Where did the member last tap? The toast rises right there — beside the
  // Save button they pressed — instead of a far-away corner.
  const lastTap = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    const track = (e: PointerEvent) => { lastTap.current = { x: e.clientX, y: e.clientY }; };
    window.addEventListener('pointerdown', track, { capture: true });
    return () => window.removeEventListener('pointerdown', track, { capture: true });
  }, []);
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [cols, setCols] = useState<CollectionRow[]>([]);
  const [newName, setNewName] = useState('');
  const [note, setNote] = useState('');
  const toastTimer = useRef<number | null>(null);
  const noteTimer = useRef<number | null>(null);

  const promptSaved = useCallback((postId: string) => {
    setToastFor(postId);
    if (lastTap.current) {
      // Clamp so the card never hangs off an edge (its width is ~330px).
      const x = Math.min(Math.max(lastTap.current.x, 175), window.innerWidth - 175);
      const y = Math.max(lastTap.current.y, 90);
      setToastPos({ x, y });
    } else {
      setToastPos(null);   // keyboard path — fall back to bottom-center
    }
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToastFor(null), 6000);
  }, []);

  const openPicker = useCallback((postId: string) => {
    setToastFor(null);
    setPickerFor(postId);
    setNewName('');
    void listMyCollections().then(setCols).catch(console.error);
  }, []);

  const flash = (text: string) => {
    setNote(text);
    if (noteTimer.current) window.clearTimeout(noteTimer.current);
    noteTimer.current = window.setTimeout(() => setNote(''), 2400);
  };

  async function addTo(collectionId: string, postId: string) {
    try {
      await addToCollection(collectionId, postId);
      flash(`Added to ${cols.find((c) => c.id === collectionId)?.name ?? 'collection'} ✓`);
    } catch (e) { console.error(e); }
    setPickerFor(null);
  }

  async function createAndAdd(postId: string) {
    const nm = newName.trim();
    if (!nm) return;
    try {
      const cid = await createCollection(nm);
      await addToCollection(cid, postId);
      flash(`Added to ${nm} ✓`);
    } catch (e) { console.error(e); }
    setNewName('');
    setPickerFor(null);
  }

  return (
    <Ctx.Provider value={{ promptSaved, openPicker }}>
      {children}

      {toastFor && (
        <div
          className={'collect__toast' + (toastPos ? ' collect__toast--anchored' : '')}
          style={toastPos ? { left: toastPos.x, top: toastPos.y - 14 } : undefined}
          role="status"
        >
          <Icon name="bookmark" size={13} />
          <span>Saved to your shelf</span>
          <button onClick={() => openPicker(toastFor)}>Add to collection…</button>
          <button className="collect__toast-x" onClick={() => setToastFor(null)} aria-label="Dismiss">
            <Icon name="close" size={11} />
          </button>
        </div>
      )}

      {note && <div className="collect__toast collect__toast--note" role="status">{note}</div>}

      {pickerFor && (
        <>
          <div className="collect__scrim" onClick={() => setPickerFor(null)} />
          <div className="collect__picker" role="dialog" aria-label="Add to collection">
            <h3>Add to collection</h3>
            {cols.length === 0 && (
              <p className="collect__muted">No folders yet — name your first:</p>
            )}
            {cols.map((c) => (
              <button key={c.id} className="collect__row" onClick={() => void addTo(c.id, pickerFor)}>
                <Icon name={c.is_public ? 'book' : 'bookmark'} size={14} />
                <span>{c.name}</span>
                <em>{c.item_count}</em>
              </button>
            ))}
            <div className="collect__new">
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="New folder name…"
                onKeyDown={(e) => { if (e.key === 'Enter') void createAndAdd(pickerFor); }}
              />
              <button disabled={!newName.trim()} onClick={() => void createAndAdd(pickerFor)}>
                Create &amp; add
              </button>
            </div>
          </div>
        </>
      )}
    </Ctx.Provider>
  );
}
