import { useEffect, useMemo, useRef } from 'react';
import type { SheetTab } from '../../lib/formula';
import { computeSheets, display, colName } from '../../lib/formula';
import { sanitizeHtml } from '../../lib/richText';
import { hydrateImgs, useSignedImgs } from '../../lib/officeMedia';
import type { Slide } from '../../lib/chatDocsApi';
import { SlideView } from './SlidesEditor';
import './Office.css';

/** A doc, read-only — for someone it was shared with to VIEW, and for the
 *  open-web page an "anyone with the link" doc answers at (2026-11-26).
 *  `imgs` = pictures already signed by the server (the open web can't sign);
 *  otherwise they're signed through the viewer's own session. */
export default function DocReader({ kind, html, sheets, slides, theme, imgs }: {
  kind: string; html?: string; sheets?: SheetTab[]; slides?: Slide[]; theme?: string; imgs?: Record<string, string>;
}) {
  const pageRef = useRef<HTMLDivElement>(null);
  const clean = useMemo(() => sanitizeHtml(html ?? ''), [html]);
  useEffect(() => {
    const el = pageRef.current;
    if (!el || kind !== 'doc') return;
    if (imgs) el.querySelectorAll<HTMLImageElement>('img[data-store]').forEach((i) => { const u = imgs[i.dataset.store ?? '']; if (u) i.src = u; });
    else void hydrateImgs(el);
  }, [clean, kind, imgs]);
  const signed = useSignedImgs(imgs ? [] : (slides ?? []).map((s) => s.image));
  const slideImgs = imgs ?? signed;
  const computed = useMemo(() => (kind === 'sheet' && sheets?.length ? computeSheets(sheets) : []), [kind, sheets]);

  if (kind === 'doc') {
    return <div className="docx__desk docx__desk--read"><div className="docx__page" ref={pageRef} dangerouslySetInnerHTML={{ __html: clean }} /></div>;
  }
  if (kind === 'slides') {
    return (
      <div className="docread__slides">
        {(slides ?? []).map((s, i) => <div className="docread__slide" key={i}><SlideView s={s} i={i} theme={theme ?? 'paper'} img={slideImgs} /></div>)}
      </div>
    );
  }
  if (kind === 'sheet') {
    return (
      <div className="docread__sheets">
        {(sheets ?? []).map((t, ti) => {
          const vals = computed[ti]?.values ?? [];
          const cols = Math.max(1, ...t.cells.map((r) => r.length));
          return (
            <section key={ti} className="docread__tab">
              {(sheets?.length ?? 0) > 1 && <h3 className="docread__tabname">{t.name}</h3>}
              <div className="docread__scroll">
                <table className="docread__table">
                  <thead><tr><th />{Array.from({ length: cols }, (_, c) => <th key={c}>{colName(c)}</th>)}</tr></thead>
                  <tbody>
                    {t.cells.map((row, r) => (
                      <tr key={r}><th>{r + 1}</th>
                        {Array.from({ length: cols }, (_, c) => <td key={c}>{vals[r]?.[c] !== undefined ? display(vals[r][c], t.fmt?.[`${r},${c}`]) : (row[c] ?? '')}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          );
        })}
      </div>
    );
  }
  return null;
}
