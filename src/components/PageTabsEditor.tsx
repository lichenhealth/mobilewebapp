import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import CoverPicker from './CoverPicker';
import ContactFields, { type ContactInfo } from './ContactFields';
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
/** Built-in tabs whose lead line + photo the owner sets (page.sections).
 *  EVERY tab carries a photo now (founder 2026-08-22: "Contact doesn't have
 *  a style button, it should have one as well. All tabs should") — built-ins
 *  through Style, write-tabs through Write; the photo lives in sections[id]
 *  either way. */
const SECTIONED = ['about', 'services', 'goods', 'contact', 'facilities'];
type SectionMeta = Record<string, { lead?: string; image?: string; imagePos?: string | number; imageSize?: string; tabOff?: boolean } | undefined>;

/** imagePos → a 0–100 vertical percent. Three generations of stored shape
 *  render alike: legacy words, the local session's bare numbers, and the
 *  drag editor's '50% N%' strings (two builds converged on this the same
 *  day — honor them all). */
function posPct(pos?: string | number): number {
  if (typeof pos === 'number') return Math.max(0, Math.min(100, pos));
  if (!pos || pos === 'center') return 50;
  if (pos === 'top') return 0;
  if (pos === 'bottom') return 100;
  const m = /50%\s+([\d.]+)%/.exec(pos);
  return m ? Math.max(0, Math.min(100, Number(m[1]))) : 50;
}

/** One photo on one tab (founder 2026-08-22 redesign): drag INSIDE the
 *  photo to choose what the standard frame shows; "Expand to full size"
 *  opts this photo out of cropping on the live page; Delete and Change sit
 *  together as plain links, no bubbles. */
function SectionPhoto({ sec, patch, uploaderId, upBusy, setUpBusy }: {
  sec: { image?: string; imagePos?: string | number; imageSize?: string } | undefined;
  patch: (p: { image?: string; imagePos?: string | number; imageSize?: string }) => void;
  uploaderId?: string;
  upBusy: boolean;
  setUpBusy: (b: boolean) => void;
}) {
  const drag = useRef<{ startY: number; startPct: number } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const full = sec?.imageSize === 'full';
  const pct = posPct(sec?.imagePos);

  const onMove = (e: React.PointerEvent) => {
    if (!drag.current || !boxRef.current) return;
    const h = boxRef.current.getBoundingClientRect().height || 1;
    // Pulling the photo down reveals what's above it — position % falls.
    const delta = ((e.clientY - drag.current.startY) / h) * 100;
    const next = Math.max(0, Math.min(100, drag.current.startPct - delta));
    patch({ imagePos: `50% ${Math.round(next)}%` });
  };

  return (
    <div className="ptabs__photo-section">
      <p className="ptabs__section-label">Photo</p>
      {sec?.image && (
        <>
          <div
            ref={boxRef}
            className={'ptabs__photo-drag' + (full ? ' is-full' : '')}
            onPointerDown={(e) => {
              if (full) return;
              e.preventDefault();
              try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* noop */ }
              drag.current = { startY: e.clientY, startPct: posPct(sec?.imagePos) };
            }}
            onPointerMove={onMove}
            onPointerUp={() => { drag.current = null; }}
            onPointerCancel={() => { drag.current = null; }}
          >
            <img
              src={sec.image} alt="" draggable={false}
              style={full ? undefined : { objectPosition: `50% ${pct}%` }}
            />
          </div>
          <p className="ptabs__note">
            {full
              ? 'Showing the whole photo, uncropped.'
              : 'Drag the photo up or down to choose what the frame shows.'}
          </p>
          <div className="ptabs__photo-links">
            <button
              type="button" className="ptabs__linkbtn"
              onClick={() => patch({ imageSize: full ? undefined : 'full' })}
            >
              {full ? '⤡ Back to standard size' : '⤢ Expand to full size'}
            </button>
            {uploaderId && (
              <label className="ptabs__linkbtn">
                {upBusy ? 'Adding…' : '↻ Change photo'}
                <input type="file" accept="image/*" hidden disabled={upBusy}
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (!file) return;
                    setUpBusy(true);
                    try { patch({ image: await uploadPageImage(uploaderId, file) }); }
                    catch (err) { console.error(err); }
                    setUpBusy(false);
                  }} />
              </label>
            )}
            <button
              type="button" className="ptabs__linkbtn ptabs__linkbtn--rm"
              onClick={() => patch({ image: undefined, imagePos: undefined, imageSize: undefined })}
            >
              × Delete
            </button>
          </div>
        </>
      )}
      {!sec?.image && uploaderId && (
        <label className="ptabs__linkbtn">
          {upBusy ? 'Adding…' : '+ Add a photo'}
          <input type="file" accept="image/*" hidden disabled={upBusy}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              setUpBusy(true);
              try { patch({ image: await uploadPageImage(uploaderId, file) }); }
              catch (err) { console.error(err); }
              setUpBusy(false);
            }} />
        </label>
      )}
    </div>
  );
}

export default function PageTabsEditor({
  tabs, onChange, photos = [], onPhotos, uploaderId, sections, onSections,
  homeSummary, onHomeSummary, coverStyle, onCoverStyle, cover, onCover, coverPos, onCoverPos,
  entityName, authorId, spaceId, homeExtra, contact, onContact, hasFacilities, team, onTeam,
}: {
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
  /** Home tab styling. */
  homeSummary?: string;
  onHomeSummary?: (text: string) => void;
  coverStyle?: 'photo' | 'plain' | 'tint';
  onCoverStyle?: (style: 'photo' | 'plain' | 'tint') => void;
  cover?: string;
  onCover?: (url: string | undefined) => void;
  coverPos?: number;
  onCoverPos?: (pos: number) => void;
  entityName?: string;
  /** Whose post photos the cover picker may harvest — a member's… */
  authorId?: string;
  /** …or a space's wall. */
  spaceId?: string;
  /** The page holds facilities text, so a Facilities tab appears by
   *  itself (founder 2026-08-26: content creates the tab; the builder can
   *  X it away). */
  hasFacilities?: boolean;
  /** page.team — the people on the page, shown in the About section.
   *  Passing onTeam turns on the People editor (founder 2026-08-26:
   *  restoring the barn's faces surfaced that team had no UI at all). */
  team?: { name: string; role?: string; note?: string; photo?: string }[];
  onTeam?: (next: { name: string; role?: string; note?: string; photo?: string }[]) => void;
  /** Extra controls under the welcome textarea (e.g. a space's
   *  "Write it for me" helper) — the caller's, rendered in place. */
  homeExtra?: React.ReactNode;
  /** The public contact block — edited INSIDE the Contact tab's Style
   *  panel (founder 2026-08-22), not as a loose builder field. */
  contact?: ContactInfo;
  onContact?: (next: ContactInfo) => void;
}) {
  const patchSection = (id: string, patch: { lead?: string; image?: string; imagePos?: string | number; tabOff?: boolean }) => {
    if (!onSections) return;
    const cur = sections ?? {};
    onSections({ ...cur, [id]: { ...cur[id], ...patch } });
  };
  const [upBusy, setUpBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const addCtaRef = useRef<HTMLButtonElement>(null);
  const scrollToCta = useRef(false);
  const closePicker = () => {
    scrollToCta.current = true;
    setAdding(false);
  };
  // The chooser is tall — folding it from anywhere should land you back at
  // the CTA, not wherever the collapse left the viewport. The scroll waits
  // for the commit that puts the CTA back in the DOM (a rAF fires too soon).
  useEffect(() => {
    if (adding || !scrollToCta.current) return;
    scrollToCta.current = false;
    // Instant, not smooth: collapsing the tall chooser clamps the scroller's
    // max-scroll at the same moment, and Chrome cancels a smooth scroll that
    // starts during the clamp — verified live, the smooth version never landed.
    addCtaRef.current?.scrollIntoView({ block: 'center' });
  }, [adding]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [homeOpen, setHomeOpen] = useState(false);
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
        Every page opens on Home — visitors land there. Each tab below is
        optional, and stays hidden until you give it something to show.
      </p>

      {/* Photo Gallery Browser — all uploaded photos in one place */}
      {photos.length > 0 && (
        <div className="ptabs__gallery-browser">
          <p className="ptabs__gallery-title">Your photos</p>
          <div className="ptabs__gallery-grid">
            {photos.map((src) => (
              <div key={src} className="ptabs__gallery-item">
                <img src={src} alt="" />
                <div className="ptabs__gallery-actions">
                  {SECTIONED.map((sectionId) => (
                    <button
                      key={sectionId}
                      className="ptabs__gallery-use"
                      onClick={() => patchSection(sectionId, { image: src })}
                      title={`Use in ${tabById(sectionId)?.label || sectionId}`}
                    >
                      Use in {tabById(sectionId)?.label || sectionId}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* HOME IS THE ALWAYS-ON DEFAULT (founder 2026-08-21): it was already
          structural — every public page leads with it — but the builder
          never said so, which made About read as the page's anchor. About
          is an optional tab like the others. */}
      <div className={'ptabs__row ptabs__row--home' + (homeOpen ? ' is-open' : '')}>
        <div className="ptabs__head">
          <span className="ptabs__icon"><Icon name="home" size={15} /></span>
          <span className="ptabs__name">Home<em className="ptabs__auto">always on — where visitors land</em></span>
          {onHomeSummary && (
            <span className="ptabs__moves">
              <button className="ptabs__mv" onClick={() => setHomeOpen(!homeOpen)}
                aria-label="Style the Home tab">
                {homeOpen ? 'Done' : 'Style'}
              </button>
            </span>
          )}
        </div>

        {homeOpen && onHomeSummary && (
          <div className="ptabs__edit">
            <label className="prof__label">Welcome message — what greets a visitor</label>
            <textarea
              className="prof__textarea"
              value={homeSummary ?? ''}
              onChange={(e) => onHomeSummary(e.target.value)}
              placeholder="A short welcome for the front page — your whole story still lives on About."
            />
            {homeExtra}
            <p className="ptabs__note">
              Leave it empty and Home opens with the first two paragraphs of your story.
            </p>

            <label className="prof__label" style={{ marginTop: '1.5rem' }}>Look</label>
            <div className="cmp__chips">
              {([['plain', 'Plain'], ['photo', 'Photo cover']] as const).map(([v, label]) => (
                <button key={v}
                  className={'cmp__chip' + ((coverStyle ?? 'plain') === v ? ' is-on' : '')}
                  onClick={() => onCoverStyle?.(v)}>{label}</button>
              ))}
            </div>
            {/* The one real cover editor — the slider and the pick-from-
                Lichen grid, not a hand-rolled twin (it briefly had one). */}
            {coverStyle === 'photo' && uploaderId && onCover && (
              <CoverPicker
                value={cover}
                onChange={onCover}
                pos={coverPos}
                onPos={onCoverPos}
                uploaderId={uploaderId}
                authorId={authorId}
                spaceId={spaceId}
                extraPhotos={photos}
              />
            )}
          </div>
        )}
      </div>

      {tabs.length === 0 && (
        <p className="ptabs__empty">No other tabs yet — your page is Home, plus your feed.</p>
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
                itself from your profile. The lead is a textarea so a real
                sentence never gets clipped mid-thought (founder 2026-08-22:
                "don't cut off the text here"). */}
            {open && tpl?.builtIn && onSections && SECTIONED.includes(t.id) && (
              <div className="ptabs__edit">
                <textarea
                  className="prof__input ptabs__lead-input"
                  rows={2}
                  value={sections?.[t.id]?.lead ?? ''}
                  placeholder="A first line — the point of this page"
                  onChange={(e) => patchSection(t.id, { lead: e.target.value || undefined })}
                />
                {/* Contact's own fields live IN its tab (founder 2026-08-22:
                    "contact and hours is supposed to be a tab that you
                    select, not a default part of the page builder"). */}
                {t.id === 'contact' && contact && onContact && (
                  <ContactFields
                    value={contact}
                    onChange={onContact}
                    lead="These appear on the public page — how someone reaches you without joining Lichen."
                  />
                )}
                <SectionPhoto
                  sec={sections?.[t.id]}
                  patch={(p) => patchSection(t.id, p)}
                  uploaderId={uploaderId}
                  upBusy={upBusy}
                  setUpBusy={setUpBusy}
                />
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
                <textarea className="prof__input ptabs__lead-input" rows={2} value={t.lead ?? ''}
                  placeholder="A first line — the point of this page"
                  onChange={(e) => patch(t.id, { lead: e.target.value || undefined })} />
                <textarea className="prof__input ptabs__body" rows={5} value={t.body ?? ''}
                  placeholder="The rest. Leave a blank line between paragraphs."
                  onChange={(e) => patch(t.id, { body: e.target.value || undefined })} />
                {/* Every tab carries a photo (founder 2026-08-22: "all tabs
                    should") — written tabs included. */}
                {onSections && (
                  <SectionPhoto
                    sec={sections?.[t.id]}
                    patch={(p) => patchSection(t.id, p)}
                    uploaderId={uploaderId}
                    upBusy={upBusy}
                    setUpBusy={setUpBusy}
                  />
                )}
              </div>
            )}
          </div>
        );
      })}
      {/* CONTENT CREATES THE TAB (founder 2026-08-26): a page holding
          facilities text grows a Facilities tab on its own — this row names
          that, and the × declines it (sections.facilities.tabOff). */}
      {hasFacilities && !tabs.some((t) => t.id === 'facilities') && !sections?.facilities?.tabOff && (
        <div className="ptabs__tab">
          <div className="ptabs__row">
            <span className="ptabs__name">
              <Icon name="location" size={15} /> Facilities
              <em className="ptabs__auto">added by itself — your page has facilities content</em>
            </span>
            <span className="ptabs__moves">
              <button className="ptabs__mv ptabs__mv--rm"
                onClick={() => patchSection('facilities', { tabOff: true })}
                aria-label="Hide the Facilities tab">×</button>
            </span>
          </div>
        </div>
      )}
      {hasFacilities && !tabs.some((t) => t.id === 'facilities') && sections?.facilities?.tabOff && (
        <p className="ptabs__note">
          The Facilities tab is hidden — its content shows on Home only.{' '}
          <button type="button" className="ptabs__restore" onClick={() => patchSection('facilities', { tabOff: false })}>
            Bring the tab back
          </button>
        </p>
      )}
      </div>

      {!adding && (
        <button type="button" className="btn ptabs__add" ref={addCtaRef} onClick={() => setAdding(true)}>
          <Icon name="plus" size={14} /> Add a tab
        </button>
      )}

      {adding && (
        <div className="ptabs__picker">
          {/* The way back is UP, at the top (founder 2026-08-21: "Never
              mind" at the foot of a long list closed things confusingly) —
              the chevron folds the chooser and lands you back on the CTA. */}
          <div className="ptabs__picker-head">
            <span className="ptabs__picker-title">Add a tab</span>
            <button type="button" className="ptabs__up" onClick={closePicker} aria-label="Close the tab chooser">
              <Icon name="arrow-up" size={14} />
            </button>
          </div>
          {/* A tab of your own (founder 2026-08-20): name it, write it — the
              same Write editor every template tab gets, and the public page
              renders it like any other. Claude can make these too. */}
          <button className="ptabs__pick" key="blank"
            onClick={() => {
              const id = 'custom-' + Math.random().toString(36).slice(2, 8);
              onChange([...tabs, { id, label: '' }]);
              setAdding(false);
              setOpenId(id);
            }}>
            <span className="ptabs__icon"><Icon name="plus" size={15} /></span>
            <span className="ptabs__pick-body">
              <strong>Blank tab</strong>
              <em>Name it and write it yourself — anything your page needs.</em>
            </span>
          </button>
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
        </div>
      )}

      {/* ── The people on the page (page.team) — rendered in the About
             section with an optional photo above each name. First UI for
             this data (founder 2026-08-26); previously only Snapshot and
             hand edits ever wrote it. ── */}
      {onTeam && (
        <div className="ptabs__people">
          <p className="ptabs__people-title">People on the page</p>
          {(team ?? []).map((person, i) => (
            <div className="ptabs__person" key={i}>
              <label className="ptabs__person-photo">
                {person.photo
                  ? <img src={person.photo} alt="" />
                  : <span className="ptabs__person-photo-empty"><Icon name="image" size={16} /></span>}
                <input
                  type="file" accept="image/*" hidden
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file || !uploaderId) return;
                    setUpBusy(true);
                    try {
                      const url = await uploadPageImage(uploaderId, file);
                      onTeam((team ?? []).map((t, j) => j === i ? { ...t, photo: url } : t));
                    } catch (err) { console.error('team photo', err); }
                    finally { setUpBusy(false); }
                  }}
                />
              </label>
              <div className="ptabs__person-fields">
                <input
                  type="text" placeholder="Name" value={person.name}
                  onChange={(e) => onTeam((team ?? []).map((t, j) => j === i ? { ...t, name: e.target.value } : t))}
                />
                <input
                  type="text" placeholder="Role — e.g. Founder & instructor" value={person.role ?? ''}
                  onChange={(e) => onTeam((team ?? []).map((t, j) => j === i ? { ...t, role: e.target.value || undefined } : t))}
                />
                <textarea
                  rows={2} placeholder="A line about them" value={person.note ?? ''}
                  onChange={(e) => onTeam((team ?? []).map((t, j) => j === i ? { ...t, note: e.target.value || undefined } : t))}
                />
                <span className="ptabs__person-acts">
                  {person.photo && (
                    <button type="button" onClick={() => onTeam((team ?? []).map((t, j) => j === i ? { ...t, photo: undefined } : t))}>
                      Remove photo
                    </button>
                  )}
                  {i > 0 && (
                    <button type="button" aria-label="Move up"
                      onClick={() => { const next = [...(team ?? [])]; [next[i - 1], next[i]] = [next[i], next[i - 1]]; onTeam(next); }}>
                      ↑
                    </button>
                  )}
                  <button type="button" className="ptabs__person-rm"
                    onClick={() => onTeam((team ?? []).filter((_, j) => j !== i))}>
                    Remove
                  </button>
                </span>
              </div>
            </div>
          ))}
          {upBusy && <p className="ptabs__note">Uploading…</p>}
          <button type="button" className="btn ptabs__add"
            onClick={() => onTeam([...(team ?? []), { name: '' }])}>
            <Icon name="plus" size={14} /> Add a person
          </button>
        </div>
      )}

    </div>
  );
}
