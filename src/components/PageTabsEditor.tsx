import { useRef, useState } from 'react';
import { Icon } from './Icon';
import { uploadPageImage } from '../lib/avatarApi';
import {
  TAB_TEMPLATES, availableTemplates, tabById, type PageTab,
} from '../lib/pageTabs';
import './PageTabsEditor.css';

/** Choose the tabs your page carries (founder 2026-08-05: "create a bunch of
 *  tab options for people that most websites would use, and people can select
 *  those templates").
 *
 *  Built-in tabs draw on what Lichen already holds — your story, your
 *  offerings, your contact details — so there's nothing to write twice. The
 *  rest are the pages a website usually has and Lichen has no opinion about;
 *  those you write here.
 *
 *  A tab stays off the live page until it has something to show, so adding one
 *  can never leave a visitor in an empty room. */
/** Built-in tabs whose lead line + photo the owner sets (page.sections). */
const SECTIONED = ['about', 'services', 'goods', 'facilities'];
type SectionMeta = Record<string, { lead?: string; image?: string } | undefined>;

export default function PageTabsEditor({ tabs, onChange, photos = [], onPhotos, uploaderId, sections, onSections }: {
  tabs: PageTab[];
  onChange: (next: PageTab[]) => void;
  /** page.photos — what the Gallery tab shows. */
  photos?: string[];
  onPhotos?: (next: string[]) => void;
  /** Whose storage folder the uploads land in (the signed-in member). */
  uploaderId?: string;
  /** page.sections — each built-in tab's own lead line and photo
   *  (founder 2026-08-11: reaching the Services photo). */
  sections?: SectionMeta;
  onSections?: (next: SectionMeta) => void;
}) {
  const patchSection = (id: string, patch: { lead?: string; image?: string }) => {
    if (!onSections) return;
    const cur = sections ?? {};
    onSections({ ...cur, [id]: { ...cur[id], ...patch } });
  };
  const [upBusy, setUpBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const spare = availableTemplates(tabs);

  // Grab-and-pull reordering (founder 2026-08-11, replacing the ↑/↓
  // arrows). Pointer events, not HTML5 drag-and-drop — this is a PWA and
  // native DnD never fires on touch. Pointer capture on the handle keeps
  // the stream alive while React re-keys the rows; rows live-shuffle as
  // the pointer crosses their midpoints, so the drop needs no ghost.
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const startDrag = (i: number) => (e: React.PointerEvent) => {
    e.preventDefault();
    // Capture can throw (pointer already lifted, or a synthetic event) —
    // the drag still works without it, capture just keeps the stream on
    // the handle once the pointer leaves it mid-pull.
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* noop */ }
    setDragIdx(i);
  };
  const onDrag = (e: React.PointerEvent) => {
    if (dragIdx === null) return;
    const rows = [...(listRef.current?.querySelectorAll<HTMLElement>('.ptabs__row') ?? [])];
    let target = dragIdx;
    rows.forEach((el, j) => {
      const r = el.getBoundingClientRect();
      if (j < dragIdx && e.clientY < r.top + r.height / 2) target = Math.min(target, j);
      if (j > dragIdx && e.clientY > r.top + r.height / 2) target = Math.max(target, j);
    });
    if (target !== dragIdx) {
      const next = [...tabs];
      const [held] = next.splice(dragIdx, 1);
      next.splice(target, 0, held);
      onChange(next);
      setDragIdx(target);
    }
  };
  const endDrag = () => setDragIdx(null);

  const patch = (id: string, p: Partial<PageTab>) =>
    onChange(tabs.map((t) => (t.id === id ? { ...t, ...p } : t)));

  return (
    <div className="ptabs">
      <p className="ptabs__lead">
        Feed always leads. Each tab below stays hidden until you give it
        something to show.
      </p>

      {tabs.length === 0 && (
        <p className="ptabs__empty">No tabs yet. Your page is just your feed.</p>
      )}

      <div className="ptabs__list" ref={listRef}>
      {tabs.map((t, i) => {
        const tpl = tabById(t.id);
        const open = openId === t.id;
        return (
          <div className={'ptabs__row' + (open ? ' is-open' : '') + (dragIdx === i ? ' is-held' : '')} key={t.id}>
            <div className="ptabs__head">
              {/* The handle only exists when there's somewhere to pull the
                  row (founder 2026-08-11: with one tab the old arrows
                  "don't seem to do anything"). */}
              {tabs.length > 1 && (
                <button
                  className="ptabs__grip"
                  onPointerDown={startDrag(i)}
                  onPointerMove={onDrag}
                  onPointerUp={endDrag}
                  onPointerCancel={endDrag}
                  aria-label="Drag to reorder"
                >
                  <Icon name="grip" size={14} />
                </button>
              )}
              <span className="ptabs__icon"><Icon name={tpl?.icon ?? 'info'} size={15} /></span>
              <span className="ptabs__name">
                {t.label ?? tpl?.label ?? t.id}
                {tpl?.builtIn && <em className="ptabs__auto">fills itself</em>}
              </span>
              <span className="ptabs__moves">
                {/* Built-in tabs fill their own BODY, but their lead line
                    and photo are the owner's (founder 2026-08-11: "I need
                    to adjust the photo on Services… how do I access that
                    tab?"). Gallery keeps its own Write door below. */}
                {(!tpl?.builtIn || (onSections && SECTIONED.includes(t.id))) && (
                  <button className="ptabs__mv" onClick={() => setOpenId(open ? null : t.id)}
                    aria-label="Edit this tab">
                    {open ? 'Done' : tpl?.builtIn ? 'Style' : 'Write'}
                  </button>
                )}
                <button className="ptabs__mv ptabs__mv--rm"
                  onClick={() => onChange(tabs.filter((x) => x.id !== t.id))}
                  aria-label="Remove this tab">×</button>
              </span>
            </div>

            {tpl?.builtIn && (
              <p className="ptabs__note">{tpl.blurb}</p>
            )}

            {/* A built-in tab's own lead + photo — its body still fills
                itself from your profile. */}
            {open && tpl?.builtIn && onSections && SECTIONED.includes(t.id) && (
              <div className="ptabs__edit">
                <input
                  className="prof__input"
                  value={sections?.[t.id]?.lead ?? ''}
                  placeholder="A first line — the point of this page"
                  onChange={(e) => patchSection(t.id, { lead: e.target.value || undefined })}
                />
                {sections?.[t.id]?.image && (
                  <span className="ptabs__shot ptabs__shot--wide">
                    <img src={sections[t.id]!.image} alt="" />
                    <button onClick={() => patchSection(t.id, { image: undefined })}
                      aria-label="Remove this photo">×</button>
                  </span>
                )}
                {uploaderId && (
                  <label className="btn ptabs__upload">
                    {upBusy ? 'Adding…' : sections?.[t.id]?.image ? 'Replace photo' : 'Add a photo'}
                    <input type="file" accept="image/*" hidden disabled={upBusy}
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        e.target.value = '';
                        if (!file) return;
                        setUpBusy(true);
                        try { patchSection(t.id, { image: await uploadPageImage(uploaderId, file) }); }
                        catch (err) { console.error(err); }
                        setUpBusy(false);
                      }} />
                  </label>
                )}
                <p className="ptabs__note">
                  This tab writes itself from your profile — the line and photo above are yours to set.
                </p>
              </div>
            )}

            {/* The Gallery tab is pictures, not prose. */}
            {open && t.id === 'gallery' && onPhotos && uploaderId && (
              <div className="ptabs__edit">
                <div className="ptabs__shots">
                  {photos.map((src) => (
                    <span className="ptabs__shot" key={src}>
                      <img src={src} alt="" />
                      <button onClick={() => onPhotos(photos.filter((x) => x !== src))}
                        aria-label="Remove this photo">×</button>
                    </span>
                  ))}
                </div>
                <label className="btn ptabs__upload">
                  {upBusy ? 'Adding…' : 'Add photos'}
                  <input type="file" accept="image/*" multiple hidden disabled={upBusy}
                    onChange={async (e) => {
                      const files = [...(e.target.files ?? [])];
                      e.target.value = '';
                      if (!files.length) return;
                      setUpBusy(true);
                      try {
                        const urls = await Promise.all(files.map((f) => uploadPageImage(uploaderId, f)));
                        onPhotos([...photos, ...urls]);
                      } catch (err) { console.error(err); }
                      setUpBusy(false);
                    }} />
                </label>
                <p className="ptabs__note">
                  Tap any photo on the live page to see it uncropped.
                </p>
              </div>
            )}

            {open && !tpl?.builtIn && t.id !== 'gallery' && (
              <div className="ptabs__edit">
                <input className="prof__input" value={t.label ?? tpl?.label ?? ''}
                  placeholder="Tab name"
                  onChange={(e) => patch(t.id, { label: e.target.value || undefined })} />
                <input className="prof__input" value={t.lead ?? ''}
                  placeholder="A first line — the point of this page"
                  onChange={(e) => patch(t.id, { lead: e.target.value || undefined })} />
                <textarea className="prof__input ptabs__body" rows={5} value={t.body ?? ''}
                  placeholder="The rest. Leave a blank line between paragraphs."
                  onChange={(e) => patch(t.id, { body: e.target.value || undefined })} />
              </div>
            )}
          </div>
        );
      })}
      </div>

      {!adding && spare.length > 0 && (
        <button className="btn ptabs__add" onClick={() => setAdding(true)}>
          <Icon name="plus" size={14} /> Add a tab
        </button>
      )}

      {adding && (
        <div className="ptabs__picker">
          {spare.map((tpl) => (
            <button className="ptabs__pick" key={tpl.id}
              onClick={() => {
                onChange([...tabs, { id: tpl.id, lead: tpl.starter || undefined }]);
                setAdding(false);
                if (!tpl.builtIn) setOpenId(tpl.id);
              }}>
              <span className="ptabs__icon"><Icon name={tpl.icon} size={15} /></span>
              <span className="ptabs__pick-body">
                <strong>{tpl.label}</strong>
                <em>{tpl.blurb}</em>
              </span>
            </button>
          ))}
          <button className="btn ptabs__cancel" onClick={() => setAdding(false)}>Never mind</button>
        </div>
      )}

      {spare.length === 0 && tabs.length === TAB_TEMPLATES.length && (
        <p className="ptabs__note">Every tab is on your page.</p>
      )}
    </div>
  );
}
