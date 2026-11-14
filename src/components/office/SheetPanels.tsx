import { useState } from 'react';
import type { Scalar, SheetTab } from '../../lib/formula';
import { colName } from '../../lib/formula';
import SheetChart from './SheetChart';
import {
  chartData, COND_LABEL, filterKey, parseRange, uid,
  type ChartType, type CondOp, type CondRule, type SheetChart as Chart, type PivotSpec,
} from '../../lib/sheetExtras';

/** The panels the toolbar opens: charts under the grid, the conditional-
 *  formatting rules list, a column's filter menu, and the pivot builder. Each
 *  hands a whole new value back; SheetEditor commits it as one undo step. */

// ── charts ──
export function ChartsStrip({ charts, vals, onChange }: { charts: Chart[]; vals: Scalar[][]; onChange: (c: Chart[]) => void }) {
  const [editing, setEditing] = useState<string | null>(null);
  if (!charts.length) return null;
  const set = (id: string, p: Partial<Chart>) => onChange(charts.map((c) => (c.id === id ? { ...c, ...p } : c)));
  return (
    <div className="sheet__charts">
      {charts.map((ch) => {
        const data = chartData(ch.range, vals);
        return (
          <figure key={ch.id} className="sheet__chart">
            <div className="sheet__charthead">
              <b>{ch.title || 'Untitled chart'}</b>
              <button onClick={() => setEditing(editing === ch.id ? null : ch.id)}>{editing === ch.id ? 'Done' : 'Edit'}</button>
              <button className="is-danger" onClick={() => onChange(charts.filter((c) => c.id !== ch.id))}>Delete</button>
            </div>
            {editing === ch.id && (
              <div className="sheet__chartform">
                <label>Title <input value={ch.title ?? ''} onChange={(e) => set(ch.id, { title: e.target.value.slice(0, 80) })} /></label>
                <label>Data <input value={ch.range} onChange={(e) => set(ch.id, { range: e.target.value.toUpperCase().slice(0, 20) })} spellCheck={false} autoCorrect="off" autoCapitalize="none" /></label>
                <div className="sheet__chips">
                  {(['column', 'bar', 'line', 'pie'] as ChartType[]).map((t) => (
                    <button key={t} className={ch.type === t ? 'is-on' : ''} onClick={() => set(ch.id, { type: t })}>{t[0].toUpperCase() + t.slice(1)}</button>
                  ))}
                </div>
              </div>
            )}
            {data ? <SheetChart data={data} type={ch.type} /> : <p className="sheet__chartempty">No numbers in {ch.range || 'that range'} yet — pick a range with a label column and numbers beside it.</p>}
          </figure>
        );
      })}
    </div>
  );
}
export const newChart = (range: string): Chart => ({ id: uid(), type: 'column', range, title: '' });

// ── conditional formatting ──
const STYLES = [
  { label: 'Green', bg: '#dcefd9', color: '#24572c' },
  { label: 'Red', bg: '#f8dcd6', color: '#8c2a1e' },
  { label: 'Yellow', bg: '#fbefc4', color: '#6b5310' },
  { label: 'Peach', bg: '#fde3cf', color: '#8a4517' },
  { label: 'Bold', bg: '', color: '', bold: true },
];
export function RulesPanel({ rules, range, onChange, onClose }: { rules: CondRule[]; range: string; onChange: (r: CondRule[]) => void; onClose: () => void }) {
  const [draft, setDraft] = useState<CondRule>({ id: uid(), range, op: 'gt', a: '', ...STYLES[0] });
  const needsA = !['empty', 'notempty', 'scale'].includes(draft.op);
  const valid = !!parseRange(draft.range) && (!needsA || (draft.a ?? '').trim() !== '') && (draft.op !== 'between' || (draft.b ?? '').trim() !== '');
  return (
    <div className="sheet__panel" role="dialog" aria-label="Conditional formatting">
      <div className="sheet__panelhead"><b>Conditional formatting</b><button onClick={onClose} aria-label="Close">×</button></div>
      {rules.length > 0 && (
        <ul className="sheet__rules">
          {rules.map((r) => (
            <li key={r.id}>
              <span className="sheet__ruleswatch" style={{ background: r.op === 'scale' ? `linear-gradient(90deg, ${r.lo || '#fff'}, ${r.hi || '#7fb685'})` : r.bg || '#fff', color: r.color, fontWeight: r.bold ? 700 : undefined }}>Aa</span>
              <span>{r.range} · {COND_LABEL[r.op]}{r.a ? ` ${r.a}` : ''}{r.op === 'between' ? ` and ${r.b}` : ''}</span>
              <button className="is-danger" onClick={() => onChange(rules.filter((x) => x.id !== r.id))}>Remove</button>
            </li>
          ))}
        </ul>
      )}
      <div className="sheet__ruleform">
        <label>Apply to <input value={draft.range} onChange={(e) => setDraft({ ...draft, range: e.target.value.toUpperCase().slice(0, 20) })} spellCheck={false} autoCorrect="off" autoCapitalize="none" /></label>
        <label>Format cells if
          <select value={draft.op} onChange={(e) => setDraft({ ...draft, op: e.target.value as CondOp })}>
            {(Object.keys(COND_LABEL) as CondOp[]).map((k) => <option key={k} value={k}>{COND_LABEL[k]}</option>)}
          </select>
        </label>
        {needsA && <label>Value <input value={draft.a ?? ''} onChange={(e) => setDraft({ ...draft, a: e.target.value })} /></label>}
        {draft.op === 'between' && <label>And <input value={draft.b ?? ''} onChange={(e) => setDraft({ ...draft, b: e.target.value })} /></label>}
        {draft.op === 'scale' ? (
          <div className="sheet__chips">
            {[['#ffffff', '#7fb685', 'White → green'], ['#7fb685', '#ffffff', 'Green → white'], ['#ffffff', '#e8866d', 'White → red'], ['#e8866d', '#7fb685', 'Red → green']].map(([lo, hi, l]) => (
              <button key={l} className={draft.lo === lo && draft.hi === hi ? 'is-on' : ''} onClick={() => setDraft({ ...draft, lo, hi })}>
                <span className="sheet__ruleswatch" style={{ background: `linear-gradient(90deg, ${lo}, ${hi})` }} /> {l}
              </button>
            ))}
          </div>
        ) : (
          <div className="sheet__chips">
            {STYLES.map((s) => (
              <button key={s.label} className={draft.bg === s.bg && draft.color === s.color && !!draft.bold === !!s.bold ? 'is-on' : ''}
                onClick={() => setDraft({ ...draft, bg: s.bg || undefined, color: s.color || undefined, bold: s.bold })}>
                <span className="sheet__ruleswatch" style={{ background: s.bg || '#fff', color: s.color, fontWeight: s.bold ? 700 : undefined }}>Aa</span> {s.label}
              </button>
            ))}
          </div>
        )}
        <button className="sheet__primary" disabled={!valid} onClick={() => { onChange([...rules, { ...draft, a: needsA ? draft.a : undefined }]); setDraft({ ...draft, id: uid() }); }}>Add rule</button>
      </div>
    </div>
  );
}

// ── a column's filter menu ──
export function FilterMenu({ at, col, vals, from, hidden, onSort, onChange, onClose }: {
  at: { x: number; y: number }; col: number; vals: Scalar[][]; from: number; hidden: string[];
  onSort: (dir: 1 | -1) => void; onChange: (hidden: string[]) => void; onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const keys: string[] = []; const seen = new Set<string>();
  for (let r = from; r < vals.length; r++) { const k = filterKey(vals[r]?.[col] ?? null); if (!seen.has(k)) { seen.add(k); keys.push(k); } }
  keys.sort((a, b) => (a === '(Blanks)' ? 1 : b === '(Blanks)' ? -1 : a.localeCompare(b, undefined, { numeric: true })));
  const shown = keys.filter((k) => k.toLowerCase().includes(q.toLowerCase()));
  const off = new Set(hidden);
  const toggle = (k: string) => { const n = new Set(off); if (n.has(k)) n.delete(k); else n.add(k); onChange([...n]); };
  return (
    <div className="sheet__filtermenu" style={{ left: at.x, top: at.y }} role="dialog" aria-label={`Filter column ${colName(col)}`} onMouseDown={(e) => e.stopPropagation()}>
      <button onClick={() => onSort(1)}>Sort A → Z</button>
      <button onClick={() => onSort(-1)}>Sort Z → A</button>
      <hr />
      <input placeholder="Search values" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="sheet__filterlinks">
        <button onClick={() => onChange(hidden.filter((h) => !shown.includes(h)))}>Select all</button>
        <button onClick={() => onChange([...new Set([...hidden, ...shown])])}>Clear</button>
      </div>
      <div className="sheet__filtervals">
        {shown.slice(0, 300).map((k) => (
          <label key={k}><input type="checkbox" checked={!off.has(k)} onChange={() => toggle(k)} /> {k}</label>
        ))}
      </div>
      <button className="sheet__primary" onClick={onClose}>Done</button>
    </div>
  );
}

// ── pivot builder ──
export function PivotPanel({ tab, vals, range, onCreate, onClose }: {
  tab: SheetTab; vals: Scalar[][]; range: string; onCreate: (spec: PivotSpec) => void; onClose: () => void;
}) {
  const g0 = parseRange(range);
  const [src, setSrc] = useState(range);
  const g = parseRange(src) ?? g0;
  const header = g?.r0 ?? 0;
  const cols = g ? Array.from({ length: g.c1 - g.c0 + 1 }, (_, i) => g.c0 + i) : [];
  const name = (c: number) => { const v = vals[header]?.[c]; return v != null && v !== '' ? String(v) : `Column ${colName(c)}`; };
  const [group, setGroup] = useState(cols[0] ?? 0);
  const [value, setValue] = useState(cols[1] ?? cols[0] ?? 0);
  const [agg, setAgg] = useState<PivotSpec['agg']>('SUM');
  const ok = !!g && g.r1 > g.r0;
  return (
    <div className="sheet__panel" role="dialog" aria-label="Pivot table">
      <div className="sheet__panelhead"><b>Pivot table</b><button onClick={onClose} aria-label="Close">×</button></div>
      <p className="sheet__panelnote">Groups the rows of {tab.name} by one column and totals another — on its own tab, live: change the data and the totals follow.</p>
      <div className="sheet__ruleform">
        <label>Data (header row first) <input value={src} onChange={(e) => setSrc(e.target.value.toUpperCase().slice(0, 20))} spellCheck={false} autoCorrect="off" autoCapitalize="none" /></label>
        {ok && <>
          <label>Rows — group by <select value={group} onChange={(e) => setGroup(+e.target.value)}>{cols.map((c) => <option key={c} value={c}>{name(c)}</option>)}</select></label>
          <label>Values <select value={value} onChange={(e) => setValue(+e.target.value)}>{cols.map((c) => <option key={c} value={c}>{name(c)}</option>)}</select></label>
          <label>Summarize by <select value={agg} onChange={(e) => setAgg(e.target.value as PivotSpec['agg'])}>
            {(['SUM', 'COUNT', 'AVERAGE', 'MAX', 'MIN'] as const).map((a) => <option key={a} value={a}>{a[0] + a.slice(1).toLowerCase()}</option>)}
          </select></label>
        </>}
        <button className="sheet__primary" disabled={!ok} onClick={() => g && onCreate({ from: tab.name, src: `${colName(g.c0)}${g.r0 + 1}:${colName(g.c1)}${g.r1 + 1}`, group, value, agg, header })}>Create pivot table</button>
      </div>
    </div>
  );
}
