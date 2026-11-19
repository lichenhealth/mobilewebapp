import { useEffect, useRef, useState } from 'react';
import type { Slide } from '../../lib/chatDocsApi';
import { uploadOfficeImage, useSignedImgs, signImgRefs } from '../../lib/officeMedia';
import { firstName, type Anchor, type Goto, type Peer } from './collab';
import './Office.css';

/** THE PRESENTATION (founder 2026-11-14: "re-create google … presos"). Google
 *  Slides' anatomy: a filmstrip of 16:9 thumbnails, the slide itself edited in
 *  place, layouts, themes, speaker notes, a full-screen Present with a
 *  speaker-notes view, PDF (print) and PowerPoint download. */

export type SlideLayout = 'title' | 'bullets' | 'section' | 'two' | 'quote' | 'big' | 'text' | 'image' | 'imagetext' | 'picture';
export const LAYOUTS: { id: SlideLayout; label: string }[] = [
  { id: 'title', label: 'Title slide' }, { id: 'bullets', label: 'Title & bullets' }, { id: 'text', label: 'Title & text' },
  { id: 'two', label: 'Two columns' }, { id: 'section', label: 'Section header' }, { id: 'quote', label: 'Quote' }, { id: 'big', label: 'Big number' },
  { id: 'image', label: 'Title & image' }, { id: 'imagetext', label: 'Image & text' },
  { id: 'picture', label: 'Full-slide picture' },
];
export const THEMES: Record<string, { label: string; bg: string; ink: string; accent: string; font: string }> = {
  paper: { label: 'Paper', bg: '#fbf7f0', ink: '#1f2a30', accent: '#c9733d', font: "'Cormorant Garamond', Georgia, serif" },
  ink: { label: 'Ink', bg: '#1f2a30', ink: '#f6efe4', accent: '#e9a77a', font: "'Cormorant Garamond', Georgia, serif" },
  moss: { label: 'Moss', bg: '#2f4a35', ink: '#f1ecdf', accent: '#d9c38a', font: "'Playfair Display', Georgia, serif" },
  peach: { label: 'Peach', bg: '#f6dcc4', ink: '#3a2418', accent: '#b4542d', font: "'Playfair Display', Georgia, serif" },
  sky: { label: 'Sky', bg: '#e6eef3', ink: '#1c2c36', accent: '#3f6f8a', font: "'Archivo', system-ui, sans-serif" },
  clay: { label: 'Clay', bg: '#b4542d', ink: '#fff4ea', accent: '#ffd8b8', font: "'Archivo', system-ui, sans-serif" },
  mono: { label: 'Clean', bg: '#ffffff', ink: '#111111', accent: '#111111', font: "'Archivo', system-ui, sans-serif" },
};
const layoutOf = (s: Slide, i: number): SlideLayout => (s.layout as SlideLayout) ?? (i === 0 ? 'title' : 'bullets');
const lines = (t: string) => t.split('\n').map((l) => l.replace(/^\s*[-•*]\s*/, '')).filter((l) => l.trim());

/** One slide, read-only or editable in place. Sizes are container-relative
 *  (cqw), so the same render is a thumbnail, the canvas, or the whole screen. */
export function SlideView({ s, i, theme, edit, img, onPickImage }: {
  s: Slide; i: number; theme: string;
  edit?: (patch: Partial<Slide>) => void;
  img?: Record<string, string>; onPickImage?: () => void;
}) {
  const th = THEMES[theme] ?? THEMES.paper;
  const L = layoutOf(s, i);
  const E = ({ field, cls, ph, multi }: { field: 'title' | 'body' | 'body2'; cls: string; ph: string; multi?: boolean }) => {
    const val = (s[field] ?? '') as string;
    if (!edit) {
      if (!val.trim()) return null;
      if (multi && (L === 'bullets' || L === 'two')) return <ul className={cls}>{lines(val).map((l, k) => <li key={k}>{l}</li>)}</ul>;
      return <div className={cls}>{val}</div>;
    }
    return <EditableText className={cls + ' slx__edit'} value={val} placeholder={ph} multi={multi} onChange={(v) => edit({ [field]: v })} bullets={!!multi && (L === 'bullets' || L === 'two')} />;
  };
  return (
    <div className={`slx__slide slx__slide--${L}`} style={{ background: th.bg, color: th.ink, ['--sl-accent' as string]: th.accent, ['--sl-font' as string]: th.font }}>
      {L === 'section' && <span className="slx__band" />}
      {L === 'quote' && <span className="slx__qmark">“</span>}
      {L === 'picture' ? (() => {
        // FULL-SLIDE PICTURE (founder 2026-11-19: an imported Google slide
        // looks exactly as Google drew it). The slide's words stay in its
        // data for search and the brain; switch the layout to edit them.
        const url = s.image ? img?.[s.image] : undefined;
        return url ? <div className="slx__full"><img src={url} alt={s.title || ''} /></div>
          : edit ? <button className="slx__img slx__img--empty slx__full" onClick={onPickImage}>＋ Add a picture</button>
          : <div className="slx__full" />;
      })() : (L === 'image' || L === 'imagetext') ? (() => {
        const url = s.image ? img?.[s.image] : undefined;
        const pic = url ? <div className="slx__img"><img src={url} alt="" /></div>
          : edit ? <button className="slx__img slx__img--empty" onClick={onPickImage}>＋ Add an image</button>
          : s.image ? <div className="slx__img" /> : null;
        return L === 'image' ? (
          <>{E({ field: 'title', cls: 'slx__t', ph: 'Click to add a title' })}{pic}</>
        ) : (
          <>{pic}<div className="slx__txt">{E({ field: 'title', cls: 'slx__t', ph: 'Click to add a title' })}{E({ field: 'body', cls: 'slx__b', ph: 'Click to add text', multi: true })}</div></>
        );
      })() : L === 'two' ? (
        <>
          {E({ field: "title", cls: "slx__t", ph: "Click to add a title", })}
          <div className="slx__cols">
            {E({ field: "body", cls: "slx__b", ph: "Left column — one point per line", multi: true, })}
            {E({ field: "body2", cls: "slx__b", ph: "Right column — one point per line", multi: true, })}
          </div>
        </>
      ) : L === 'quote' ? (
        <>
          {E({ field: "body", cls: "slx__q", ph: "Click to add the quote", multi: true, })}
          {E({ field: "title", cls: "slx__attr", ph: "— who said it", })}
        </>
      ) : (
        <>
          {E({ field: "title", cls: "slx__t", ph: L === 'big' ? '42%' : 'Click to add a title', })}
          {E({ field: "body", cls: "slx__b", ph: L === 'title' ? 'Click to add a subtitle' : L === 'big' ? 'What the number means' : L === 'bullets' ? 'One point per line' : 'Click to add text', multi: true, })}
        </>
      )}
    </div>
  );
}

function EditableText({ value, onChange, className, placeholder, multi, bullets }: {
  value: string; onChange: (v: string) => void; className: string; placeholder: string; multi?: boolean; bullets?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (ref.current && ref.current.innerText.replace(/\n$/, '') !== value) ref.current.innerText = value; }, [value]);
  return (
    <div
      ref={ref}
      className={className + (bullets ? ' slx__edit--bullets' : '')}
      contentEditable="plaintext-only"
      suppressContentEditableWarning
      data-placeholder={placeholder}
      onInput={(e) => onChange((e.currentTarget as HTMLDivElement).innerText.replace(/\n$/, ''))}
      onKeyDown={(e) => { if (!multi && e.key === 'Enter') e.preventDefault(); }}
    />
  );
}

export default function SlidesEditor({ slides, theme, onChange, title, chatId, onAnchor, marks, peers, goto }: {
  slides: Slide[]; theme: string; onChange: (slides: Slide[], theme: string) => void; title: string; chatId?: string | null;
  onAnchor?: (a: Anchor) => void; marks?: Set<number>; peers?: Peer[]; goto?: Goto | null;
}) {
  const imgs = useSignedImgs(slides.map((x) => x.image));
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [cur, setCur] = useState(0);
  const [present, setPresent] = useState<number | null>(null);
  const [notesView, setNotesView] = useState(false);
  const [menu, setMenu] = useState<'layout' | 'new' | 'theme' | null>(null);
  const deckRef = useRef<HTMLDivElement>(null);
  const i = Math.min(cur, slides.length - 1);
  const s = slides[i];

  useEffect(() => { onAnchor?.({ kind: 'slide', index: i }); }, [i, onAnchor]);
  useEffect(() => { const a = goto?.anchor; if (a?.kind === 'slide') setCur(Math.min(a.index, slides.length - 1)); }, [goto?.n]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (next: Slide[], th = theme) => onChange(next, th);
  const patch = (p: Partial<Slide>) => set(slides.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const add = (layout: SlideLayout) => { const n = [...slides]; n.splice(i + 1, 0, { title: '', body: '', layout }); set(n); setCur(i + 1); setMenu(null); };
  const dup = () => { const n = [...slides]; n.splice(i + 1, 0, { ...slides[i] }); set(n); setCur(i + 1); };
  const del = () => { if (slides.length < 2) return; set(slides.filter((_, j) => j !== i)); setCur(Math.max(0, i - 1)); };
  const pickImage = () => fileRef.current?.click();
  const takeImage = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true);
    try {
      const ref = await uploadOfficeImage(f, chatId ?? null);
      const L = layoutOf(s, i);
      patch({ image: ref, ...(L === 'image' || L === 'imagetext' || L === 'picture' ? {} : { layout: s.body?.trim() ? 'imagetext' : 'image' }) });
    } catch { window.alert("That image didn't upload — try again in a moment."); }
    finally { setBusy(false); }
  };
  const move = (d: -1 | 1) => { const j = i + d; if (j < 0 || j >= slides.length) return; const n = [...slides]; [n[i], n[j]] = [n[j], n[i]]; set(n); setCur(j); };

  const startPresent = (from: number) => {
    setPresent(from);
    requestAnimationFrame(() => { void deckRef.current?.requestFullscreen?.().catch(() => {}); });
  };
  const stop = () => { setPresent(null); if (document.fullscreenElement) void document.exitFullscreen().catch(() => {}); };
  useEffect(() => {
    if (present == null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') stop();
      else if (['ArrowRight', ' ', 'PageDown', 'Enter'].includes(e.key)) { e.preventDefault(); setPresent((p) => (p == null ? p : Math.min(p + 1, slides.length - 1))); }
      else if (['ArrowLeft', 'PageUp', 'Backspace'].includes(e.key)) { e.preventDefault(); setPresent((p) => (p == null ? p : Math.max(p - 1, 0))); }
      else if (e.key.toLowerCase() === 's') setNotesView((v) => !v);
    };
    const onFs = () => { if (!document.fullscreenElement) setPresent((p) => p); };
    window.addEventListener('keydown', onKey); document.addEventListener('fullscreenchange', onFs);
    return () => { window.removeEventListener('keydown', onKey); document.removeEventListener('fullscreenchange', onFs); };
  }, [present, slides.length]);

  const exportPptx = async () => {
    const { default: PptxGen } = await import('pptxgenjs');
    const th = THEMES[theme] ?? THEMES.paper;
    const pptx = new PptxGen();
    pptx.layout = 'LAYOUT_WIDE';
    pptx.title = title;
    const hex = (c: string) => c.replace('#', '');
    // Images ride into the .pptx as data, read through fresh signed links.
    const urls = await signImgRefs(slides.map((x) => x.image ?? ''));
    const pics: Record<string, string> = {};
    await Promise.all(Object.entries(urls).map(async ([ref, u]) => {
      try {
        const b = await (await fetch(u)).blob();
        pics[ref] = await new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsDataURL(b); });
      } catch { /* the slide keeps its words */ }
    }));
    slides.forEach((sl, k) => {
      const L = layoutOf(sl, k);
      const p = pptx.addSlide();
      p.background = { color: hex(th.bg) };
      const face = th.font.includes('Archivo') ? 'Arial' : 'Georgia';
      const tx = { color: hex(th.ink), fontFace: face };
      if (L === 'picture' && sl.image && pics[sl.image]) {
        p.addImage({ data: pics[sl.image], x: 0, y: 0, w: 13.33, h: 7.5, sizing: { type: 'contain', w: 13.33, h: 7.5 } });
      } else if ((L === 'image' || L === 'imagetext') && sl.image && pics[sl.image]) {
        const data = pics[sl.image];
        if (L === 'image') {
          p.addText(sl.title || ' ', { ...tx, x: 0.6, y: 0.3, w: 12, h: 0.9, fontSize: 32, bold: true });
          p.addImage({ data, x: 0.6, y: 1.4, w: 12.1, h: 5.7, sizing: { type: 'cover', w: 12.1, h: 5.7 } });
        } else {
          p.addImage({ data, x: 0.5, y: 0.5, w: 6, h: 6.5, sizing: { type: 'cover', w: 6, h: 6.5 } });
          p.addText(sl.title || ' ', { ...tx, x: 6.9, y: 1.2, w: 5.9, h: 1.2, fontSize: 32, bold: true });
          if (sl.body) p.addText(sl.body, { ...tx, x: 6.9, y: 2.5, w: 5.9, h: 4, fontSize: 20, valign: 'top' });
        }
      } else if (L === 'title' || L === 'section') {
        if (L === 'section') p.addShape('rect', { x: 0.6, y: 3.0, w: 1.2, h: 0.08, fill: { color: hex(th.accent) } });
        p.addText(sl.title || ' ', { ...tx, x: 0.6, y: L === 'title' ? 2.2 : 3.2, w: 12, h: 1.4, fontSize: 44, bold: true, align: L === 'title' ? 'center' : 'left' });
        if (sl.body) p.addText(sl.body, { ...tx, x: 0.6, y: L === 'title' ? 3.7 : 4.6, w: 12, h: 1, fontSize: 22, align: L === 'title' ? 'center' : 'left', color: hex(th.accent) });
      } else if (L === 'quote') {
        p.addText(`“${sl.body}”`, { ...tx, x: 1, y: 1.5, w: 11.3, h: 3.2, fontSize: 34, italic: true });
        if (sl.title) p.addText(sl.title, { ...tx, x: 1, y: 5, w: 11.3, h: 0.7, fontSize: 20, color: hex(th.accent) });
      } else if (L === 'big') {
        p.addText(sl.title || ' ', { ...tx, x: 0.6, y: 1.6, w: 12, h: 2.4, fontSize: 110, bold: true, align: 'center', color: hex(th.accent) });
        if (sl.body) p.addText(sl.body, { ...tx, x: 0.6, y: 4.3, w: 12, h: 1, fontSize: 24, align: 'center' });
      } else {
        p.addText(sl.title || ' ', { ...tx, x: 0.6, y: 0.4, w: 12, h: 1, fontSize: 34, bold: true });
        const bul = (t: string) => lines(t).map((l) => ({ text: l, options: { bullet: L !== 'text' } }));
        if (L === 'two') {
          p.addText(bul(sl.body), { ...tx, x: 0.6, y: 1.6, w: 5.8, h: 5, fontSize: 20, valign: 'top' });
          p.addText(bul(sl.body2 ?? ''), { ...tx, x: 6.8, y: 1.6, w: 5.8, h: 5, fontSize: 20, valign: 'top' });
        } else {
          p.addText(L === 'text' ? sl.body : bul(sl.body), { ...tx, x: 0.6, y: 1.6, w: 12, h: 5, fontSize: 22, valign: 'top' });
        }
      }
      if (sl.notes) p.addNotes(sl.notes);
    });
    await pptx.writeFile({ fileName: `${title || 'Presentation'}.pptx` });
  };

  return (
    <div className="slx">
      <div className="sheet__bar slx__bar" role="toolbar" aria-label="Presentation tools">
        <div className="sheet__pop">
          <button onClick={() => setMenu(menu === 'new' ? null : 'new')}>+ New slide ▾</button>
          {menu === 'new' && <div className="sheet__menu" onMouseLeave={() => setMenu(null)}>{LAYOUTS.map((l) => <button key={l.id} onClick={() => add(l.id)}>{l.label}</button>)}</div>}
        </div>
        <div className="sheet__pop">
          <button onClick={() => setMenu(menu === 'layout' ? null : 'layout')}>Layout ▾</button>
          {menu === 'layout' && <div className="sheet__menu" onMouseLeave={() => setMenu(null)}>{LAYOUTS.map((l) => <button key={l.id} className={layoutOf(s, i) === l.id ? 'is-on' : ''} onClick={() => { patch({ layout: l.id }); setMenu(null); }}>{l.label}</button>)}</div>}
        </div>
        <div className="sheet__pop">
          <button onClick={() => setMenu(menu === 'theme' ? null : 'theme')}>Theme ▾</button>
          {menu === 'theme' && (
            <div className="sheet__menu slx__themes" onMouseLeave={() => setMenu(null)}>
              {Object.entries(THEMES).map(([k, t]) => (
                <button key={k} className={theme === k ? 'is-on' : ''} onClick={() => { set(slides, k); setMenu(null); }}>
                  <span className="slx__swatch" style={{ background: t.bg, color: t.ink, borderColor: t.accent }}>Aa</span> {t.label}
                </button>
              ))}
            </div>
          )}
        </div>
        <button title="Add an image to this slide" disabled={busy} onClick={pickImage}>{busy ? 'Uploading…' : '🖼 Image'}</button>
        {s.image && <button title="Remove this slide's image" onClick={() => patch({ image: undefined })}>Remove image</button>}
        <input ref={fileRef} type="file" hidden accept="image/*,.heic,.heif" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; void takeImage(f); }} />
        <span className="sheet__sep" />
        <button title="Duplicate slide" onClick={dup}>⧉ Duplicate</button>
        <button title="Move slide up" onClick={() => move(-1)} disabled={i === 0}>↑</button>
        <button title="Move slide down" onClick={() => move(1)} disabled={i === slides.length - 1}>↓</button>
        <button title="Delete slide" onClick={del} disabled={slides.length < 2}>Delete</button>
        <span className="sheet__sep" />
        <button title="Print or save as PDF" onClick={() => window.print()}>PDF ⎙</button>
        <button title="Download as PowerPoint" onClick={() => void exportPptx()}>.pptx ↓</button>
        <button className="slx__present" onClick={() => startPresent(i)}>▶ Present</button>
      </div>

      <div className="slx__work">
        <div className="slx__strip" aria-label="Slides">
          {slides.map((sl, k) => (
            <button key={k} className={'slx__thumb' + (k === i ? ' is-on' : '')} onClick={() => setCur(k)} aria-label={`Slide ${k + 1}`}>
              <span className="slx__n">{k + 1}</span>
              {marks?.has(k) && <span className="slx__note" aria-label="Has comments">💬</span>}
              {(peers ?? []).filter((p) => p.anchor?.kind === 'slide' && p.anchor.index === k).map((p) => (
                <span key={p.uid} className="slx__peer" style={{ background: p.color }} title={`${p.name} is here`}>{firstName(p.name)[0]}</span>
              ))}
              <SlideView s={sl} i={k} theme={theme} img={imgs} />
            </button>
          ))}
          <button className="slx__thumb slx__thumb--add" onClick={() => add('bullets')} aria-label="Add a slide">+</button>
        </div>
        <div className="slx__main">
          <div className="slx__canvas"><SlideView key={i} s={s} i={i} theme={theme} edit={patch} img={imgs} onPickImage={pickImage} /></div>
          <textarea className="slx__notes" placeholder="Speaker notes — only you see these while presenting" value={s.notes ?? ''}
            onChange={(e) => patch({ notes: e.target.value })} />
        </div>
      </div>

      <div className="office-print slx__print" aria-hidden>
        {slides.map((sl, k) => <div className="slx__printpage" key={k}><SlideView s={sl} i={k} theme={theme} img={imgs} /></div>)}
      </div>

      {present != null && slides[present] && (
        <div className="slx__deck" ref={deckRef} role="dialog" aria-label="Presenting"
          onClick={() => setPresent((p) => (p == null ? p : Math.min(p + 1, slides.length - 1)))}>
          <div className={'slx__stage' + (notesView ? ' with-notes' : '')}>
            <div className="slx__fit"><SlideView s={slides[present]} i={present} theme={theme} img={imgs} /></div>
            {notesView && (
              <div className="slx__speaker" onClick={(e) => e.stopPropagation()}>
                <strong>Speaker notes</strong>
                <p>{slides[present].notes?.trim() || 'No notes on this slide.'}</p>
                {slides[present + 1] && <><strong>Next</strong><p>{slides[present + 1].title || `Slide ${present + 2}`}</p></>}
              </div>
            )}
          </div>
          <div className="slx__deckbar" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => setPresent(Math.max(0, present - 1))} disabled={present === 0} aria-label="Previous">‹</button>
            <span>{present + 1} / {slides.length}</span>
            <button onClick={() => setPresent(Math.min(slides.length - 1, present + 1))} disabled={present === slides.length - 1} aria-label="Next">›</button>
            <button onClick={() => setNotesView((v) => !v)}>{notesView ? 'Hide notes' : 'Speaker notes'}</button>
            <button onClick={stop}>Exit</button>
          </div>
        </div>
      )}
    </div>
  );
}
