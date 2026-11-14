/** Sheets' second floor (founder 2026-11-14: charts, conditional formatting,
 *  filters, pivot tables). Everything here is DATA on the tab — the parent
 *  autosaves it like any other edit — and every evaluator reads COMPUTED
 *  values, so a chart or a rule follows its formulas live. */
import { parseA1, display, isNumeric, DateVal, a1, colName, type Scalar, type SheetTab } from './formula';

export type ChartType = 'column' | 'bar' | 'line' | 'pie';
export interface SheetChart { id: string; type: ChartType; range: string; title?: string }

export type CondOp = 'gt' | 'lt' | 'gte' | 'lte' | 'eq' | 'neq' | 'between' | 'contains' | 'empty' | 'notempty' | 'scale';
export interface CondRule { id: string; range: string; op: CondOp; a?: string; b?: string; bg?: string; color?: string; bold?: boolean; lo?: string; hi?: string }

export interface SheetFilter { row: number; hidden: Record<string, string[]> }

export interface PivotSpec { from: string; src: string; group: number; value: number; agg: 'SUM' | 'COUNT' | 'AVERAGE' | 'MAX' | 'MIN'; header: number }

/** Validated with the dataviz validator (light surface): peach, blue, gold, green, purple, rust. */
export const CHART_COLORS = ['#c9733d', '#2f78ad', '#c49a1f', '#3d8c4f', '#8a56b0', '#b8443a'];

export const uid = () => Math.random().toString(36).slice(2, 10);

export interface Rng { r0: number; c0: number; r1: number; c1: number }
export function parseRange(s: string): Rng | null {
  const [a, b] = s.replace(/\$/g, '').toUpperCase().split(':');
  const p = parseA1(a ?? ''); const q = b ? parseA1(b) : p;
  if (!p || !q) return null;
  return { r0: Math.min(p.r, q.r), c0: Math.min(p.c, q.c), r1: Math.max(p.r, q.r), c1: Math.max(p.c, q.c) };
}
export const rangeText = (g: Rng) => (g.r0 === g.r1 && g.c0 === g.c1 ? a1(g.r0, g.c0) : `${a1(g.r0, g.c0)}:${a1(g.r1, g.c1)}`);

const num = (v: Scalar): number | null => (typeof v === 'number' ? v : v instanceof DateVal ? v.n : null);
const lit = (s: string | undefined): number | string => { const t = (s ?? '').trim(); const n = Number(t.replace(/[$,%\s]/g, '')); return t !== '' && Number.isFinite(n) ? (t.endsWith('%') ? n / 100 : n) : t.toLowerCase(); };

// ── conditional formatting ──
export interface CellStyle { bg?: string; color?: string; bold?: boolean }
const mix = (a: string, b: string, t: number) => {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const x = p(a), y = p(b);
  return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('');
};
export function condStyles(rules: CondRule[] | undefined, vals: Scalar[][]): Map<string, CellStyle> {
  const out = new Map<string, CellStyle>();
  for (const rule of rules ?? []) {
    const g = parseRange(rule.range); if (!g) continue;
    let mn = Infinity, mx = -Infinity;
    if (rule.op === 'scale') for (let r = g.r0; r <= g.r1; r++) for (let c = g.c0; c <= g.c1; c++) { const n = num(vals[r]?.[c] ?? null); if (n != null) { mn = Math.min(mn, n); mx = Math.max(mx, n); } }
    for (let r = g.r0; r <= g.r1; r++) for (let c = g.c0; c <= g.c1; c++) {
      const k = `${r},${c}`; if (out.has(k)) continue;   // first matching rule wins
      const v = vals[r]?.[c] ?? null;
      if (rule.op === 'scale') {
        const n = num(v); if (n == null || mx === -Infinity) continue;
        out.set(k, { bg: mix(rule.lo || '#ffffff', rule.hi || '#7fb685', mx === mn ? 1 : (n - mn) / (mx - mn)) });
        continue;
      }
      if (matches(rule, v)) out.set(k, { bg: rule.bg, color: rule.color, bold: rule.bold });
    }
  }
  return out;
}
function matches(rule: CondRule, v: Scalar): boolean {
  const empty = v == null || v === '';
  if (rule.op === 'empty') return empty;
  if (rule.op === 'notempty') return !empty;
  if (empty) return false;
  if (rule.op === 'contains') return display(v).toLowerCase().includes((rule.a ?? '').toLowerCase());
  const n = num(v); const A = lit(rule.a), B = lit(rule.b);
  if (rule.op === 'eq' || rule.op === 'neq') {
    const same = typeof A === 'number' ? n === A : display(v).toLowerCase() === A;
    return rule.op === 'eq' ? same : !same;
  }
  if (n == null || typeof A !== 'number') return false;
  switch (rule.op) {
    case 'gt': return n > A; case 'lt': return n < A; case 'gte': return n >= A; case 'lte': return n <= A;
    case 'between': return typeof B === 'number' && n >= Math.min(A, B) && n <= Math.max(A, B);
    default: return false;
  }
}
export const COND_LABEL: Record<CondOp, string> = {
  gt: 'Greater than', gte: 'Greater than or equal', lt: 'Less than', lte: 'Less than or equal', eq: 'Is equal to', neq: 'Is not equal to',
  between: 'Is between', contains: 'Text contains', empty: 'Is empty', notempty: 'Is not empty', scale: 'Color scale',
};

// ── filters ──
export const filterKey = (v: Scalar) => (v == null || v === '' ? '(Blanks)' : display(v));
export function hiddenRows(f: SheetFilter | undefined, vals: Scalar[][]): Set<number> {
  const out = new Set<number>(); if (!f) return out;
  const cols = Object.entries(f.hidden).filter(([, xs]) => xs.length);
  if (!cols.length) return out;
  for (let r = f.row + 1; r < vals.length; r++) {
    for (const [c, xs] of cols) if (xs.includes(filterKey(vals[r]?.[Number(c)] ?? null))) { out.add(r); break; }
  }
  return out;
}

// ── charts ──
export interface ChartData { labels: string[]; series: { name: string; values: (number | null)[] }[] }
export function chartData(rangeStr: string, vals: Scalar[][]): ChartData | null {
  const g = parseRange(rangeStr); if (!g) return null;
  const at = (r: number, c: number) => vals[r]?.[c] ?? null;
  const cols = g.c1 - g.c0 + 1;
  const hasHeader = Array.from({ length: cols }, (_, j) => at(g.r0, g.c0 + j)).some((v, j) => (j > 0 || cols === 1) && v != null && v !== '' && !isNumeric(v));
  const labelCol = cols > 1;
  const r0 = hasHeader ? g.r0 + 1 : g.r0;
  const labels: string[] = [];
  for (let r = r0; r <= g.r1; r++) labels.push(labelCol ? display(at(r, g.c0)) : String(r - r0 + 1));
  const series: ChartData['series'] = [];
  for (let c = labelCol ? g.c0 + 1 : g.c0; c <= g.c1; c++) {
    const values: (number | null)[] = [];
    for (let r = r0; r <= g.r1; r++) values.push(num(at(r, c)));
    if (values.every((v) => v == null)) continue;
    series.push({ name: hasHeader ? display(at(g.r0, c)) || colName(c) : colName(c), values });
  }
  return series.length && labels.length ? { labels, series } : null;
}
export function niceTicks(lo: number, hi: number, n = 5): number[] {
  if (lo === hi) { hi = lo + 1; }
  const span = hi - lo; const step0 = span / n;
  const mag = 10 ** Math.floor(Math.log10(step0)); const err = step0 / mag;
  const step = (err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1) * mag;
  const out: number[] = [];
  for (let t = Math.floor(lo / step) * step; t <= hi + step * 1e-9; t += step) out.push(Math.round(t / step) * step);
  if (out[out.length - 1] < hi) out.push(out[out.length - 1] + step);
  return out;
}

// ── pivot tables (live: SUMIFS/COUNTIFS formulas over the source) ──
export function buildPivot(src: SheetTab, spec: PivotSpec, vals: Scalar[][]): string[][] {
  const g = parseRange(spec.src)!;
  const q = /^[A-Za-z_][\w.]*$/.test(src.name) ? src.name : `'${src.name.replace(/'/g, "''")}'`;
  const keyCol = colName(spec.group), valCol = colName(spec.value);
  const first = spec.header + 2, last = g.r1 + 1;
  const keyRng = `${q}!$${keyCol}$${first}:$${keyCol}$${last}`, valRng = `${q}!$${valCol}$${first}:$${valCol}$${last}`;
  const keys: string[] = []; const seen = new Set<string>();
  for (let r = spec.header + 1; r <= g.r1; r++) {
    const v = vals[r]?.[spec.group]; if (v == null || v === '') continue;
    const k = display(v); if (!seen.has(k.toLowerCase())) { seen.add(k.toLowerCase()); keys.push(k); }
  }
  keys.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
  const head = (c: number) => display(vals[spec.header]?.[c] ?? null) || colName(c);
  const fn = { SUM: 'SUMIFS', COUNT: 'COUNTIFS', AVERAGE: 'AVERAGEIFS', MAX: 'MAXIFS', MIN: 'MINIFS' }[spec.agg];
  const rows: string[][] = [[head(spec.group), `${spec.agg === 'COUNT' ? 'Count' : spec.agg[0] + spec.agg.slice(1).toLowerCase()} of ${head(spec.value)}`]];
  keys.forEach((k, i) => {
    const crit = `A${i + 2}`;
    rows.push([/^[=+]/.test(k) ? ` ${k}` : k, spec.agg === 'COUNT' ? `=COUNTIFS(${keyRng},${crit})` : `=${fn}(${valRng},${keyRng},${crit})`]);
  });
  const end = keys.length + 1;
  const total = { SUM: `=SUM(B2:B${end})`, COUNT: `=SUM(B2:B${end})`, AVERAGE: `=AVERAGE(${valRng})`, MAX: `=MAX(B2:B${end})`, MIN: `=MIN(B2:B${end})` }[spec.agg];
  rows.push(['Grand total', total]);
  return rows;
}
