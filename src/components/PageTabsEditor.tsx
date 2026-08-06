import { useState } from 'react';
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
export default function PageTabsEditor({ tabs, onChange, photos = [], onPhotos, uploaderId }: {
  tabs: PageTab[];
  onChange: (next: PageTab[]) => void;
  /** page.photos — what the Gallery tab shows. */
  photos?: string[];
  onPhotos?: (next: string[]) => void;
  /** Whose storage folder the uploads land in (the signed-in member). */
  uploaderId?: string;
}) {
  const [upBusy, setUpBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const spare = availableTemplates(tabs);

  const move = (i: number, by: number) => {
    const next = [...tabs];
    const j = i + by;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  const patch = (id: string, p: Partial<PageTab>) =>
    onChange(tabs.map((t) => (t.id === id ? { ...t, ...p } : t)));

  return (
    <div className="ptabs">
      <p className="ptabs__lead">
        Feed always leads. These follow it — and each one waits until it has
        something to say before a visitor sees it.
      </p>

      {tabs.length === 0 && (
        <p className="ptabs__empty">No tabs yet — your page is just your feed.</p>
      )}

      {tabs.map((t, i) => {
        const tpl = tabById(t.id);
        const open = openId === t.id;
        return (
          <div className={'ptabs__row' + (open ? ' is-open' : '')} key={t.id}>
            <div className="ptabs__head">
              <span className="ptabs__icon"><Icon name={tpl?.icon ?? 'info'} size={15} /></span>
              <span className="ptabs__name">
                {t.label ?? tpl?.label ?? t.id}
                {tpl?.builtIn && <em className="ptabs__auto">fills itself</em>}
              </span>
              <span className="ptabs__moves">
                <button className="ptabs__mv" onClick={() => move(i, -1)} aria-label="Move up">↑</button>
                <button className="ptabs__mv" onClick={() => move(i, 1)} aria-label="Move down">↓</button>
                {!tpl?.builtIn && (
                  <button className="ptabs__mv" onClick={() => setOpenId(open ? null : t.id)}
                    aria-label="Edit this tab">{open ? 'Done' : 'Write'}</button>
                )}
                <button className="ptabs__mv ptabs__mv--rm"
                  onClick={() => onChange(tabs.filter((x) => x.id !== t.id))}
                  aria-label="Remove this tab">×</button>
              </span>
            </div>

            {tpl?.builtIn && (
              <p className="ptabs__note">{tpl.blurb}</p>
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
