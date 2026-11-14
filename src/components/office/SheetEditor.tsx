import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  computeSheets, display, isNumeric, colName, a1, shiftFormula, offsetFormula, FUNCTIONS,
  literal, DateVal, type SheetTab, type CellFmt, type Scalar,
} from '../../lib/formula';
import { condStyles, hiddenRows, buildPivot, rangeText } from '../../lib/sheetExtras';
import { ChartsStrip, newChart, RulesPanel, FilterMenu, PivotPanel } from './SheetPanels';
import { cellMark, firstName, type Anchor, type Goto, type Peer } from './collab';
import './Office.css';

/** THE SPREADSHEET (founder 2026-11-14: "re-create google spreadsheets").
 *  Google Sheets' working anatomy on Lichen's paper: name box + formula bar,
 *  lettered columns / numbered rows, a selectable range, live formulas
 *  (src/lib/formula.ts), formatting, insert/delete that rewrites refs, sort,
 *  freeze, tabs, copy/paste that moves relative refs, undo, CSV/XLSX in and
 *  out, and the Sum/Avg/Count readout. Controlled: the parent owns `tabs`
 *  and autosaves whatever onChange hands it. */

type Pos = { r: number; c: number };
const key = (r: number, c: number) => `${r},${c}`;
const asNum = (v: Scalar) => (typeof v === 'number' ? v : v instanceof DateVal ? v.n : 0);
const clone = (t: SheetTab[]): SheetTab[] => JSON.parse(JSON.stringify(t));
const COLORS = ['#1f2a30', '#6b7378', '#b4542d', '#c9733d', '#d9a441', '#4f7a4a', '#3f6f8a', '#7a5a8c', '#ffffff'];
const FILLS = ['#fff7ed', '#fde8d4', '#f6dfc8', '#eaf2e3', '#e3eef4', '#efe6f3', '#fdf3c8', '#f1efe9', ''];

export default function SheetEditor({ tabs, onChange, title, onAnchor, marks, peers, goto }: {
  tabs: SheetTab[]; onChange: (t: SheetTab[]) => void; title: string;
  onAnchor?: (a: Anchor) => void; marks?: Set<string>; peers?: Peer[]; goto?: Goto | null;
}) {
  const [ti, setTi] = useState(0);
  const tab = tabs[Math.min(ti, tabs.length - 1)];
  const [sel, setSel] = useState<Pos>({ r: 0, c: 0 });
  const [anchor, setAnchor] = useState<Pos>({ r: 0, c: 0 });
  const [edit, setEdit] = useState<{ value: string; bar: boolean } | null>(null);
  const [extraRows, setExtraRows] = useState(0);
  const [pal, setPal] = useState<'color' | 'bg' | 'num' | null>(null);
  const [renaming, setRenaming] = useState<number | null>(null);
  const [tabMenu, setTabMenu] = useState<number | null>(null);
  const [acIdx, setAcIdx] = useState(0);
  const [panel, setPanel] = useState<'rules' | 'pivot' | null>(null);
  const [filterCol, setFilterCol] = useState<number | null>(null);
  const [filterAt, setFilterAt] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const undo = useRef<SheetTab[][]>([]);
  const redo = useRef<SheetTab[][]>([]);
  const clip = useRef<{ tsv: string; raw: string[][]; fmt: (CellFmt | undefined)[][]; origin: Pos; cut: boolean; ti: number } | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const cellInput = useRef<HTMLInputElement>(null);
  const barInput = useRef<HTMLInputElement>(null);
  const dragging = useRef(false);
  const resize = useRef<{ c: number; x: number; w: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const computed = useMemo(() => computeSheets(tabs), [tabs]);
  const vals = computed[Math.min(ti, tabs.length - 1)]?.values ?? [];
  const cstyles = useMemo(() => condStyles(tab.cond, vals), [tab.cond, vals]);
  const hidden = useMemo(() => hiddenRows(tab.filter, vals), [tab.filter, vals]);
  const width = Math.max(0, ...tab.cells.map((r) => r.length));
  const nCols = Math.min(52, Math.max(width + 3, 12));
  const nRows = Math.max(tab.cells.length + 15, 40) + extraRows;
  const frozen = tab.frozen ?? 0;
  const lo = { r: Math.min(sel.r, anchor.r), c: Math.min(sel.c, anchor.c) };
  const hi = { r: Math.max(sel.r, anchor.r), c: Math.max(sel.c, anchor.c) };
  const inSel = (r: number, c: number) => r >= lo.r && r <= hi.r && c >= lo.c && c <= hi.c;
  const raw = (r: number, c: number) => tab.cells[r]?.[c] ?? '';
  const fmtOf = (r: number, c: number) => tab.fmt?.[key(r, c)];

  // ── collaboration: report where I am, jump where a comment points ──
  useEffect(() => { onAnchor?.({ kind: 'cell', tab: tab.name, r: sel.r, c: sel.c }); }, [sel.r, sel.c, tab.name, onAnchor]);
  useEffect(() => {
    const a = goto?.anchor; if (!a || a.kind !== 'cell') return;
    const idx = tabs.findIndex((t) => t.name === a.tab);
    if (idx >= 0 && idx !== ti) setTi(idx);
    setEdit(null);
    requestAnimationFrame(() => go(a.r, a.c));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goto?.n]);
  const peerAt = useMemo(() => {
    const m = new Map<string, Peer>();
    for (const p of peers ?? []) if (p.anchor?.kind === 'cell' && p.anchor.tab === tab.name) m.set(key(p.anchor.r, p.anchor.c), p);
    return m;
  }, [peers, tab.name]);

  // ── mutations (every one is an undo step) ──
  const commit = useCallback((next: SheetTab[]) => {
    undo.current.push(clone(tabs)); if (undo.current.length > 100) undo.current.shift();
    redo.current = [];
    onChange(next);
  }, [tabs, onChange]);
  const mutate = (fn: (t: SheetTab, all: SheetTab[]) => void) => {
    const next = clone(tabs); fn(next[ti], next); commit(next);
  };
  const put = (t: SheetTab, r: number, c: number, v: string) => {
    while (t.cells.length <= r) t.cells.push([]);
    const row = t.cells[r]; while (row.length <= c) row.push('');
    row[c] = v;
  };
  const trim = (t: SheetTab) => {
    while (t.cells.length > 1 && t.cells[t.cells.length - 1].every((x) => !x)) t.cells.pop();
  };
  const setFmt = (patch: Partial<CellFmt> | ((f: CellFmt) => Partial<CellFmt>)) => mutate((t) => {
    t.fmt = { ...(t.fmt ?? {}) };
    for (let r = lo.r; r <= hi.r; r++) for (let c = lo.c; c <= hi.c; c++) {
      const cur = t.fmt[key(r, c)] ?? {};
      const p = typeof patch === 'function' ? patch(cur) : patch;
      const nf: CellFmt = { ...cur, ...p };
      (Object.keys(nf) as (keyof CellFmt)[]).forEach((k) => { if (nf[k] === undefined || nf[k] === false || nf[k] === '') delete nf[k]; });
      if (Object.keys(nf).length) t.fmt[key(r, c)] = nf; else delete t.fmt[key(r, c)];
    }
  });
  const doUndo = () => { const p = undo.current.pop(); if (!p) return; redo.current.push(clone(tabs)); onChange(p); };
  const doRedo = () => { const n = redo.current.pop(); if (!n) return; undo.current.push(clone(tabs)); onChange(n); };

  const startEdit = (value: string, bar = false) => {
    setEdit({ value, bar }); setAcIdx(0);
    requestAnimationFrame(() => { const el = bar ? barInput.current : cellInput.current; el?.focus(); if (el) el.setSelectionRange(el.value.length, el.value.length); });
  };
  const finish = (move: Pos | null) => {
    if (edit) {
      const v = edit.value;
      if (v !== raw(sel.r, sel.c)) mutate((t) => { put(t, sel.r, sel.c, v); trim(t); });
    }
    setEdit(null);
    if (move) go(move.r, move.c);
    requestAnimationFrame(() => gridRef.current?.focus());
  };
  const go = (r: number, c: number, extend = false) => {
    const p = { r: Math.max(0, Math.min(r, nRows - 1)), c: Math.max(0, Math.min(c, nCols - 1)) };
    setSel(p); if (!extend) setAnchor(p);
    requestAnimationFrame(() => {
      gridRef.current?.querySelector(`[data-cell="${p.r}-${p.c}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
  };

  // ── autocomplete for function names while typing a formula ──
  const acToken = edit && edit.value.startsWith('=') ? /(?:^=|[(,+\-*/^&<>=:\s])([A-Za-z]{1,12})$/.exec(edit.value)?.[1] : undefined;
  const ac = acToken ? FUNCTIONS.filter((f) => f.name.startsWith(acToken.toUpperCase())).slice(0, 6) : [];
  const applyAc = (name: string) => {
    if (!edit || !acToken) return;
    startEdit(edit.value.slice(0, edit.value.length - acToken.length) + name + '(', edit.bar);
  };
  const wantsRef = !!edit && edit.value.startsWith('=') && /[=(,+\-*/^&<>:]$/.test(edit.value);

  // ── structure ──
  const shiftAll = (all: SheetTab[], axis: 'row' | 'col', at: number, delta: number) => {
    const name = all[ti].name;
    for (const t of all) for (const row of t.cells) for (let c = 0; c < row.length; c++) {
      if (row[c].startsWith('=')) row[c] = shiftFormula(row[c], t.name, name, axis, at, delta);
    }
    // Charts, rules and the filter row ride the same shift as the formulas.
    const t = all[ti];
    const sh = (r: string) => shiftFormula('=' + r, name, name, axis, at, delta).slice(1);
    if (t.charts) t.charts = t.charts.map((ch) => ({ ...ch, range: sh(ch.range) }));
    if (t.cond) t.cond = t.cond.map((cr) => ({ ...cr, range: sh(cr.range) })).filter((cr) => !cr.range.includes('#REF'));
    if (t.filter && axis === 'row' && t.filter.row >= at) {
      if (delta < 0 && t.filter.row < at - delta) delete t.filter; else t.filter.row += delta;
    }
    if (t.filter && axis === 'col') {
      const h: Record<string, string[]> = {};
      for (const [c, xs] of Object.entries(t.filter.hidden)) { const n = Number(c); if (delta < 0 && n >= at && n < at - delta) continue; h[String(n >= at ? n + delta : n)] = xs; }
      t.filter.hidden = h;
    }
  };
  const shiftFmt = (t: SheetTab, axis: 'row' | 'col', at: number, delta: number) => {
    if (!t.fmt) return;
    const nf: Record<string, CellFmt> = {};
    for (const [k, f] of Object.entries(t.fmt)) {
      let [r, c] = k.split(',').map(Number);
      const v = axis === 'row' ? r : c;
      if (delta < 0 && v >= at && v < at - delta) continue;
      if (v >= at) { if (axis === 'row') r += delta; else c += delta; }
      nf[key(r, c)] = f;
    }
    t.fmt = nf;
  };
  const insertRows = (at: number, n = 1) => mutate((t, all) => {
    shiftAll(all, 'row', at, n); shiftFmt(t, 'row', at, n);
    while (t.cells.length < at) t.cells.push([]);
    t.cells.splice(at, 0, ...Array.from({ length: n }, () => [] as string[]));
  });
  const deleteRows = () => mutate((t, all) => {
    const n = hi.r - lo.r + 1;
    t.cells.splice(lo.r, n); shiftFmt(t, 'row', lo.r, -n); shiftAll(all, 'row', lo.r, -n);
    if (!t.cells.length) t.cells.push(['']);
  });
  const insertCols = (at: number, n = 1) => mutate((t, all) => {
    shiftAll(all, 'col', at, n); shiftFmt(t, 'col', at, n);
    for (const row of t.cells) if (row.length > at) row.splice(at, 0, ...Array(n).fill(''));
    if (t.colW) t.colW.splice(at, 0, ...Array(n).fill(0));
  });
  const deleteCols = () => mutate((t, all) => {
    const n = hi.c - lo.c + 1;
    for (const row of t.cells) row.splice(lo.c, n);
    if (t.colW) t.colW.splice(lo.c, n);
    shiftFmt(t, 'col', lo.c, -n); shiftAll(all, 'col', lo.c, -n);
  });
  const sortBy = (dir: 1 | -1, col?: number, from?: number) => mutate((t) => {
    const c = col ?? sel.c;
    const multi = col == null && hi.r > lo.r;
    const start = from ?? (multi ? lo.r : frozen);
    const end = multi ? hi.r : t.cells.length - 1;
    if (end <= start) return;
    const comp = computed[ti].values;
    const rows = t.cells.slice(start, end + 1).map((row, i) => ({ row, src: start + i, v: comp[start + i]?.[c] ?? null }));
    const rank = (v: Scalar) => (v == null || v === '' ? 2 : isNumeric(v) ? 0 : 1);
    rows.sort((a, b) => {
      const ra = rank(a.v), rb = rank(b.v);
      if (ra !== rb) return ra - rb;
      if (ra === 2) return 0;
      if (ra === 0) return dir * (asNum(a.v) - asNum(b.v));
      return dir * String(display(a.v)).localeCompare(String(display(b.v)), undefined, { numeric: true, sensitivity: 'base' });
    });
    rows.forEach((x, i) => {
      t.cells[start + i] = x.row.map((cell) => (cell.startsWith('=') ? offsetFormula(cell, start + i - x.src, 0) : cell));
    });
  });

  // ── clipboard ──
  const rangeTsv = () => {
    const lines: string[] = [];
    for (let r = lo.r; r <= hi.r; r++) {
      const row: string[] = [];
      for (let c = lo.c; c <= hi.c; c++) row.push(display(vals[r]?.[c] ?? null, fmtOf(r, c)).replace(/[\t\n]/g, ' '));
      lines.push(row.join('\t'));
    }
    return lines.join('\n');
  };
  const onCopy = (e: React.ClipboardEvent, cut = false) => {
    if (edit) return;
    e.preventDefault();
    const tsv = rangeTsv();
    e.clipboardData.setData('text/plain', tsv);
    const rawR: string[][] = [], fmtR: (CellFmt | undefined)[][] = [];
    for (let r = lo.r; r <= hi.r; r++) { const a: string[] = [], f: (CellFmt | undefined)[] = []; for (let c = lo.c; c <= hi.c; c++) { a.push(raw(r, c)); f.push(fmtOf(r, c)); } rawR.push(a); fmtR.push(f); }
    clip.current = { tsv, raw: rawR, fmt: fmtR, origin: { ...lo }, cut, ti };
  };
  const onPaste = (e: React.ClipboardEvent) => {
    if (edit) return;
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    const mine = clip.current && clip.current.tsv === text ? clip.current : null;
    mutate((t, all) => {
      if (mine) {
        const dr = sel.r - mine.origin.r, dc = sel.c - mine.origin.c;
        if (mine.cut) {
          const src = all[mine.ti];
          mine.raw.forEach((row, i) => row.forEach((_, j) => { put(src, mine.origin.r + i, mine.origin.c + j, ''); if (src.fmt) delete src.fmt[key(mine.origin.r + i, mine.origin.c + j)]; }));
        }
        mine.raw.forEach((row, i) => row.forEach((v, j) => {
          put(t, sel.r + i, sel.c + j, v.startsWith('=') && !mine.cut ? offsetFormula(v, dr, dc) : v);
          const f = mine.fmt[i][j]; t.fmt = { ...(t.fmt ?? {}) };
          if (f) t.fmt[key(sel.r + i, sel.c + j)] = f; else delete t.fmt[key(sel.r + i, sel.c + j)];
        }));
        if (mine.cut) clip.current = null;
      } else {
        const rows = text.replace(/\r/g, '').replace(/\n$/, '').split('\n').map((l) => l.split('\t'));
        rows.forEach((row, i) => row.forEach((v, j) => put(t, sel.r + i, sel.c + j, v)));
      }
      trim(t);
    });
  };

  // ── keyboard on the grid ──
  const onKey = (e: React.KeyboardEvent) => {
    if (edit) {
      // Keys that land before the cell's input takes focus still belong to it.
      if (e.target === gridRef.current && !e.metaKey && !e.ctrlKey) {
        if (e.key.length === 1) { e.preventDefault(); setEdit((cur) => (cur ? { ...cur, value: cur.value + e.key } : cur)); }
        else if (e.key === 'Backspace') { e.preventDefault(); setEdit((cur) => (cur ? { ...cur, value: cur.value.slice(0, -1) } : cur)); }
        else if (e.key === 'Enter') { e.preventDefault(); finish({ r: sel.r + 1, c: sel.c }); }
      }
      return;
    }
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) doRedo(); else doUndo(); return; }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); doRedo(); return; }
    if (mod && e.key.toLowerCase() === 'b') { e.preventDefault(); setFmt((f) => ({ b: !f.b })); return; }
    if (mod && e.key.toLowerCase() === 'i') { e.preventDefault(); setFmt((f) => ({ i: !f.i })); return; }
    if (mod && e.key.toLowerCase() === 'u') { e.preventDefault(); setFmt((f) => ({ u: !f.u })); return; }
    if (mod && e.key.toLowerCase() === 'a') { e.preventDefault(); setAnchor({ r: 0, c: 0 }); setSel({ r: Math.max(tab.cells.length - 1, 0), c: Math.max(width - 1, 0) }); return; }
    if (mod && (e.key.toLowerCase() === 'd' || e.key.toLowerCase() === 'r')) {
      e.preventDefault();
      const down = e.key.toLowerCase() === 'd';
      mutate((t) => {
        for (let r = lo.r; r <= hi.r; r++) for (let c = lo.c; c <= hi.c; c++) {
          const sr = down ? lo.r : r, sc = down ? c : lo.c;
          if (sr === r && sc === c) continue;
          const v = raw(sr, sc);
          put(t, r, c, v.startsWith('=') ? offsetFormula(v, r - sr, c - sc) : v);
        }
      });
      return;
    }
    const moves: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    if (moves[e.key]) {
      e.preventDefault();
      const [dr, dc] = moves[e.key];
      if (mod) {
        // Jump to the edge of the data, the Sheets way.
        const r = dr ? (dr > 0 ? Math.max(tab.cells.length - 1, 0) : 0) : sel.r;
        const c = dc ? (dc > 0 ? Math.max(width - 1, 0) : 0) : sel.c;
        go(r, c, e.shiftKey);
      } else go(sel.r + dr, sel.c + dc, e.shiftKey);
      return;
    }
    if (e.key === 'Tab') { e.preventDefault(); go(sel.r, sel.c + (e.shiftKey ? -1 : 1)); return; }
    if (e.key === 'Enter' || e.key === 'F2') { e.preventDefault(); startEdit(raw(sel.r, sel.c)); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      mutate((t) => { for (let r = lo.r; r <= hi.r; r++) for (let c = lo.c; c <= hi.c; c++) if (t.cells[r]?.[c]) t.cells[r][c] = ''; trim(t); });
      return;
    }
    if (e.key.length === 1 && !mod && !e.altKey) { e.preventDefault(); startEdit(e.key); }
  };
  const onEditKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (ac.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); setAcIdx((i) => (i + (e.key === 'ArrowDown' ? 1 : -1) + ac.length) % ac.length); return; }
    if (ac.length && e.key === 'Tab') { e.preventDefault(); applyAc(ac[acIdx]?.name ?? ac[0].name); return; }
    if (e.key === 'Enter') { e.preventDefault(); finish({ r: sel.r + (e.shiftKey ? -1 : 1), c: sel.c }); }
    else if (e.key === 'Tab') { e.preventDefault(); finish({ r: sel.r, c: sel.c + (e.shiftKey ? -1 : 1) }); }
    else if (e.key === 'Escape') { e.preventDefault(); setEdit(null); gridRef.current?.focus(); }
  };

  // ── mouse ──
  const cellDown = (e: React.MouseEvent, r: number, c: number) => {
    if (edit && wantsRef) {
      // Click a cell while writing a formula = insert its reference.
      e.preventDefault();
      startEdit(edit.value + a1(r, c), edit.bar);
      return;
    }
    if (edit) finish(null);
    if (e.shiftKey) { setSel({ r, c }); return; }
    if (!edit && sel.r === r && sel.c === c && anchor.r === r && anchor.c === c && e.detail === 1 && 'ontouchstart' in window) {
      startEdit(raw(r, c)); return;
    }
    go(r, c); dragging.current = true;
  };
  const cellEnter = (r: number, c: number) => { if (dragging.current) setSel({ r, c }); };
  useEffect(() => {
    const up = () => { dragging.current = false; resize.current = null; };
    const move = (e: MouseEvent) => {
      const rz = resize.current; if (!rz) return;
      const w = Math.max(40, rz.w + e.clientX - rz.x);
      const next = clone(tabs); const t = next[ti];
      t.colW = [...(t.colW ?? [])]; while (t.colW.length <= rz.c) t.colW.push(0); t.colW[rz.c] = w;
      onChange(next);
    };
    window.addEventListener('mouseup', up); window.addEventListener('mousemove', move);
    return () => { window.removeEventListener('mouseup', up); window.removeEventListener('mousemove', move); };
  }, [tabs, ti, onChange]);
  const colW = (c: number) => tab.colW?.[c] || 100;

  // ── tabs ──
  const addTab = () => {
    const names = new Set(tabs.map((t) => t.name.toLowerCase()));
    let n = tabs.length + 1; while (names.has(`sheet${n}`)) n++;
    commit([...clone(tabs), { name: `Sheet${n}`, cells: [['']] }]); setTi(tabs.length);
  };
  const renameTab = (i: number, name: string) => {
    const nm = name.trim().slice(0, 40);
    setRenaming(null);
    if (!nm || nm === tabs[i].name || tabs.some((t, j) => j !== i && t.name.toLowerCase() === nm.toLowerCase())) return;
    const old = tabs[i].name;
    const next = clone(tabs); next[i].name = nm;
    const esc = old.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(^|[^\\w'])('${esc.replace(/'/g, "''")}'|${esc})!`, 'gi');
    const q = /^[A-Za-z_][\w.]*$/.test(nm) ? nm : `'${nm.replace(/'/g, "''")}'`;
    for (const t of next) for (const row of t.cells) row.forEach((v, c) => { if (v.startsWith('=')) row[c] = v.replace(re, (_m, pre) => `${pre}${q}!`); });
    for (const t of next) if (t.pivot?.from === old) t.pivot = { ...t.pivot, from: nm };
    commit(next);
  };

  // ── import / export ──
  const download = (name: string, blob: Blob) => {
    const u = URL.createObjectURL(blob); const a = document.createElement('a');
    a.href = u; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(u), 2000);
  };
  const exportCsv = () => {
    const rows = vals.map((row, r) => row.map((v, c) => { const s = display(v, fmtOf(r, c)); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(','));
    download(`${title || 'Spreadsheet'} - ${tab.name}.csv`, new Blob([rows.join('\n')], { type: 'text/csv' }));
  };
  const exportXlsx = async () => {
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    tabs.forEach((t, i) => {
      const ws: Record<string, unknown> = {};
      let maxR = 0, maxC = 0;
      t.cells.forEach((row, r) => row.forEach((v, c) => {
        if (!v) return; maxR = Math.max(maxR, r); maxC = Math.max(maxC, c);
        const comp = computed[i].values[r]?.[c];
        const ref = XLSX.utils.encode_cell({ r, c });
        if (v.startsWith('=')) ws[ref] = { t: typeof comp === 'number' ? 'n' : 's', f: v.slice(1), v: typeof comp === 'number' ? comp : display(comp ?? null) };
        else { const l = literal(v); ws[ref] = typeof l === 'number' ? { t: 'n', v: l } : { t: 's', v }; }
      }));
      ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: maxR, c: maxC } });
      XLSX.utils.book_append_sheet(wb, ws as never, t.name.slice(0, 31));
    });
    const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    download(`${title || 'Spreadsheet'}.xlsx`, new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  };
  const importFile = async (f: File) => {
    const XLSX = await import('xlsx');
    const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' });
    const names = new Set(tabs.map((t) => t.name.toLowerCase()));
    const added: SheetTab[] = [];
    for (const sn of wb.SheetNames) {
      const ws = wb.Sheets[sn];
      if (!ws['!ref']) continue;
      const rng = XLSX.utils.decode_range(ws['!ref']);
      const cells: string[][] = [];
      for (let r = rng.s.r; r <= Math.min(rng.e.r, 2000); r++) {
        const row: string[] = [];
        for (let c = rng.s.c; c <= Math.min(rng.e.c, 51); c++) {
          const cell = ws[XLSX.utils.encode_cell({ r, c })] as { f?: string; w?: string; v?: unknown } | undefined;
          row.push(cell ? (cell.f ? `=${cell.f}` : String(cell.w ?? cell.v ?? '')) : '');
        }
        cells.push(row);
      }
      let nm = sn.slice(0, 40); let k = 2; while (names.has(nm.toLowerCase())) nm = `${sn.slice(0, 36)} ${k++}`;
      names.add(nm.toLowerCase());
      added.push({ name: nm, cells });
    }
    if (!added.length) return;
    const blank = tabs.length === 1 && tabs[0].cells.every((r) => r.every((x) => !x));
    const next = blank ? added : [...clone(tabs), ...added];
    commit(next); setTi(blank ? 0 : tabs.length);
  };

  // ── charts / rules / filters / pivots ──
  const selRange = rangeText({ r0: lo.r, c0: lo.c, r1: hi.r, c1: hi.c });
  const dataRange = () => {
    if (multi) return selRange;
    // One cell picked: the block of data around it, the Sheets way.
    const w = Math.max(1, ...tab.cells.map((r) => { let n = r.length; while (n && !r[n - 1]) n--; return n; }));
    return rangeText({ r0: 0, c0: 0, r1: Math.max(0, tab.cells.length - 1), c1: w - 1 });
  };
  const insertChart = () => mutate((t) => { t.charts = [...(t.charts ?? []), newChart(dataRange())]; });
  const toggleFilter = () => {
    if (tab.filter) { mutate((t) => { delete t.filter; }); setFilterCol(null); return; }
    mutate((t) => { t.filter = { row: multi ? lo.r : frozen ? frozen - 1 : 0, hidden: {} }; });
  };
  const createPivot = (spec: import('../../lib/sheetExtras').PivotSpec) => {
    const names = new Set(tabs.map((t) => t.name.toLowerCase()));
    let n = 1; while (names.has(`pivot table ${n}`)) n++;
    const cells = buildPivot(tab, spec, vals);
    const fmt: Record<string, CellFmt> = { '0,0': { b: true }, '0,1': { b: true }, [`${cells.length - 1},0`]: { b: true }, [`${cells.length - 1},1`]: { b: true } };
    commit([...clone(tabs), { name: `Pivot table ${n}`, cells, fmt, frozen: 1, colW: [180, 160], pivot: spec }]);
    setTi(tabs.length); setPanel(null);
  };
  const refreshPivot = () => {
    const spec = tab.pivot; if (!spec) return;
    const si = tabs.findIndex((t) => t.name === spec.from);
    if (si < 0) return;
    const cells = buildPivot(tabs[si], spec, computed[si].values);
    mutate((t) => {
      t.cells = cells;
      t.fmt = { '0,0': { b: true }, '0,1': { b: true }, [`${cells.length - 1},0`]: { b: true }, [`${cells.length - 1},1`]: { b: true } };
    });
  };
  const pivotSourceMissing = !!tab.pivot && !tabs.some((t) => t.name === tab.pivot!.from);

  // ── readouts ──
  const nums: number[] = [];
  let filled = 0;
  for (let r = lo.r; r <= hi.r; r++) for (let c = lo.c; c <= hi.c; c++) {
    const v = vals[r]?.[c];
    if (v != null && v !== '') filled++;
    if (typeof v === 'number') nums.push(v);
  }
  const sum = nums.reduce((a, b) => a + b, 0);
  const curF = fmtOf(sel.r, sel.c) ?? {};
  const multi = hi.r > lo.r || hi.c > lo.c;
  const nameBox = multi ? `${a1(lo.r, lo.c)}:${a1(hi.r, hi.c)}` : a1(sel.r, sel.c);
  const showText = (r: number, c: number) => {
    const rv = raw(r, c);
    const f = fmtOf(r, c);
    if (!rv.startsWith('=') && !f?.num) return rv;   // typed text reads as typed
    return display(vals[r]?.[c] ?? null, f);
  };

  return (
    <div className="sheet">
      <div className="sheet__bar" role="toolbar" aria-label="Spreadsheet tools">
        <button title="Undo (Ctrl+Z)" onClick={doUndo} disabled={!undo.current.length}>↶</button>
        <button title="Redo (Ctrl+Y)" onClick={doRedo} disabled={!redo.current.length}>↷</button>
        <span className="sheet__sep" />
        <button title="Format as currency" className={curF.num === 'currency' ? 'is-on' : ''} onClick={() => setFmt({ num: curF.num === 'currency' ? undefined : 'currency' })}>$</button>
        <button title="Format as percent" className={curF.num === 'percent' ? 'is-on' : ''} onClick={() => setFmt({ num: curF.num === 'percent' ? undefined : 'percent' })}>%</button>
        <button title="Fewer decimals" onClick={() => setFmt((f) => ({ dec: Math.max(0, (f.dec ?? 2) - 1) }))}>.0←</button>
        <button title="More decimals" onClick={() => setFmt((f) => ({ dec: Math.min(8, (f.dec ?? 2) + 1) }))}>.00→</button>
        <div className="sheet__pop">
          <button title="More formats" onClick={() => setPal(pal === 'num' ? null : 'num')}>123 ▾</button>
          {pal === 'num' && (
            <div className="sheet__menu" onMouseLeave={() => setPal(null)}>
              {([['auto', 'Automatic'], ['number', 'Number 1,000.12'], ['currency', 'Currency $1,000.12'], ['percent', 'Percent 10.12%'], ['date', 'Date 11/14/2026'], ['text', 'Plain text']] as const).map(([k, l]) => (
                <button key={k} onClick={() => { setFmt({ num: k === 'auto' ? undefined : k, dec: undefined }); setPal(null); }}>{l}</button>
              ))}
            </div>
          )}
        </div>
        <span className="sheet__sep" />
        <button title="Bold (Ctrl+B)" className={curF.b ? 'is-on' : ''} onClick={() => setFmt({ b: !curF.b })}><b>B</b></button>
        <button title="Italic (Ctrl+I)" className={curF.i ? 'is-on' : ''} onClick={() => setFmt({ i: !curF.i })}><i>I</i></button>
        <button title="Underline (Ctrl+U)" className={curF.u ? 'is-on' : ''} onClick={() => setFmt({ u: !curF.u })}><u>U</u></button>
        <button title="Strikethrough" className={curF.s ? 'is-on' : ''} onClick={() => setFmt({ s: !curF.s })}><s>S</s></button>
        <div className="sheet__pop">
          <button title="Text color" onClick={() => setPal(pal === 'color' ? null : 'color')}><span style={{ borderBottom: `3px solid ${curF.color ?? '#1f2a30'}` }}>A</span></button>
          {pal === 'color' && <div className="sheet__swatches" onMouseLeave={() => setPal(null)}>{COLORS.map((c) => <button key={c} style={{ background: c }} aria-label={c} onClick={() => { setFmt({ color: c === '#1f2a30' ? undefined : c }); setPal(null); }} />)}</div>}
        </div>
        <div className="sheet__pop">
          <button title="Fill color" onClick={() => setPal(pal === 'bg' ? null : 'bg')}><span className="sheet__fillico" style={{ background: curF.bg ?? 'transparent' }}>◧</span></button>
          {pal === 'bg' && <div className="sheet__swatches" onMouseLeave={() => setPal(null)}>{FILLS.map((c) => <button key={c || 'none'} style={{ background: c || '#fff' }} aria-label={c || 'No fill'} onClick={() => { setFmt({ bg: c || undefined }); setPal(null); }}>{c ? '' : '∅'}</button>)}</div>}
        </div>
        <span className="sheet__sep" />
        <button title="Align left" className={curF.align === 'left' ? 'is-on' : ''} onClick={() => setFmt({ align: 'left' })}>⇤</button>
        <button title="Align center" className={curF.align === 'center' ? 'is-on' : ''} onClick={() => setFmt({ align: 'center' })}>↔</button>
        <button title="Align right" className={curF.align === 'right' ? 'is-on' : ''} onClick={() => setFmt({ align: 'right' })}>⇥</button>
        <button title="Wrap text" className={curF.wrap ? 'is-on' : ''} onClick={() => setFmt({ wrap: !curF.wrap })}>↵</button>
        <span className="sheet__sep" />
        <button title="Sum the cells above" onClick={() => {
          let r0 = sel.r - 1; while (r0 >= 0 && isNumeric(vals[r0]?.[sel.c] ?? null)) r0--;
          if (r0 + 1 <= sel.r - 1) mutate((t) => put(t, sel.r, sel.c, `=SUM(${a1(r0 + 1, sel.c)}:${a1(sel.r - 1, sel.c)})`));
          else startEdit('=SUM(');
        }}>Σ</button>
        <button title="Sort A → Z by this column" onClick={() => sortBy(1)}>A→Z</button>
        <button title="Sort Z → A by this column" onClick={() => sortBy(-1)}>Z→A</button>
        <button title={tab.filter ? 'Turn the filter off (shows every row)' : 'Filter: a ▾ on each header to hide values'} className={tab.filter ? 'is-on' : ''} onClick={toggleFilter}>⏷ Filter</button>
        <button title={frozen ? 'Unfreeze the header row' : 'Freeze the top row'} className={frozen ? 'is-on' : ''} onClick={() => mutate((t) => { t.frozen = t.frozen ? 0 : 1; })}>❄</button>
        <span className="sheet__sep" />
        <button title="Insert a row above" onClick={() => insertRows(lo.r)}>+ Row ↑</button>
        <button title="Insert a row below" onClick={() => insertRows(hi.r + 1)}>+ Row ↓</button>
        <button title="Insert a column left" onClick={() => insertCols(lo.c)}>+ Col ←</button>
        <button title="Insert a column right" onClick={() => insertCols(hi.c + 1)}>+ Col →</button>
        <button title="Delete the selected rows" onClick={deleteRows}>− Row</button>
        <button title="Delete the selected columns" onClick={deleteCols}>− Col</button>
        <span className="sheet__sep" />
        <button title="Insert a chart from the selected data" onClick={insertChart}>📊 Chart</button>
        <button title="Conditional formatting: color cells by their values" className={panel === 'rules' ? 'is-on' : ''} onClick={() => setPanel(panel === 'rules' ? null : 'rules')}>🎨 Rules</button>
        <button title="Pivot table: group and total on a new tab" className={panel === 'pivot' ? 'is-on' : ''} onClick={() => setPanel(panel === 'pivot' ? null : 'pivot')}>⊞ Pivot</button>
        <span className="sheet__sep" />
        <button title="Import a .xlsx or .csv file as new tabs" onClick={() => fileRef.current?.click()}>Import</button>
        <button title="Download this tab as CSV" onClick={exportCsv}>CSV ↓</button>
        <button title="Download the whole spreadsheet as Excel" onClick={() => void exportXlsx()}>.xlsx ↓</button>
        <input ref={fileRef} type="file" hidden accept=".xlsx,.xls,.csv,.ods" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void importFile(f); }} />
      </div>

      {panel === 'rules' && (
        <RulesPanel rules={tab.cond ?? []} range={dataRange()} onClose={() => setPanel(null)}
          onChange={(rules) => mutate((t) => { t.cond = rules.length ? rules : undefined; })} />
      )}
      {panel === 'pivot' && <PivotPanel tab={tab} vals={vals} range={dataRange()} onCreate={createPivot} onClose={() => setPanel(null)} />}
      {tab.pivot && (
        <div className="sheet__pivotnote">
          {pivotSourceMissing
            ? <>This pivot table's source tab "{tab.pivot.from}" is gone — its totals can't refresh.</>
            : <>Pivot table of <b>{tab.pivot.from}</b> {tab.pivot.src}. Totals stay live; new group values appear when you <button onClick={refreshPivot}>Refresh</button></>}
        </div>
      )}

      <div className="sheet__fx">
        <span className="sheet__namebox">{nameBox}</span>
        <span className="sheet__fxlabel">fx</span>
        <div className="sheet__fxwrap">
          <input
            ref={barInput}
            className="sheet__fxinput"
            value={edit ? edit.value : raw(sel.r, sel.c)}
            onFocus={() => { if (!edit) startEdit(raw(sel.r, sel.c), true); }}
            onChange={(e) => setEdit({ value: e.target.value, bar: true })}
            onKeyDown={onEditKey}
            onBlur={() => { if (edit?.bar) setTimeout(() => { if (document.activeElement !== barInput.current) finish(null); }, 120); }}
            aria-label="Formula bar"
            spellCheck={false} autoCorrect="off" autoCapitalize="none"
          />
          {ac.length > 0 && (
            <div className="sheet__ac">
              {ac.map((f, i) => (
                <button key={f.name} className={i === acIdx ? 'is-on' : ''} onMouseDown={(e) => { e.preventDefault(); applyAc(f.name); }}>
                  <b>{f.name}</b><span>{f.hint}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div
        className="sheet__grid" ref={gridRef} tabIndex={0}
        onKeyDown={onKey} onCopy={(e) => onCopy(e)} onCut={(e) => onCopy(e, true)} onPaste={onPaste}
      >
        <table style={{ width: 46 + Array.from({ length: nCols }, (_, c) => colW(c)).reduce((a, b) => a + b, 0) }}>
          <colgroup>
            <col style={{ width: 46 }} />
            {Array.from({ length: nCols }, (_, c) => <col key={c} style={{ width: colW(c) }} />)}
          </colgroup>
          <thead>
            <tr>
              <th className="sheet__corner" onClick={() => { setAnchor({ r: 0, c: 0 }); setSel({ r: nRows - 1, c: nCols - 1 }); }} />
              {Array.from({ length: nCols }, (_, c) => (
                <th key={c} className={c >= lo.c && c <= hi.c ? 'is-sel' : ''}
                  onMouseDown={(e) => { if ((e.target as HTMLElement).classList.contains('sheet__rz')) return; if (e.shiftKey) setSel({ r: nRows - 1, c }); else { setAnchor({ r: 0, c }); setSel({ r: nRows - 1, c }); } }}>
                  {colName(c)}
                  <span className="sheet__rz" onMouseDown={(e) => { e.preventDefault(); resize.current = { c, x: e.clientX, w: colW(c) }; }} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: nRows }, (_, r) => hidden.has(r) ? null : (
              <tr key={r} className={r < frozen ? 'is-frozen' : ''} style={r < frozen ? { top: 26 + r * 27 } : undefined}>
                <th className={r >= lo.r && r <= hi.r ? 'is-sel' : ''}
                  onMouseDown={(e) => { if (e.shiftKey) setSel({ r, c: nCols - 1 }); else { setAnchor({ r, c: 0 }); setSel({ r, c: nCols - 1 }); } }}>{r + 1}</th>
                {Array.from({ length: nCols }, (_, c) => {
                  const f = fmtOf(r, c);
                  const cs = cstyles.get(key(r, c));
                  const isFilterHead = tab.filter?.row === r && c < Math.max(width, 1);
                  const filtered = !!tab.filter?.hidden[String(c)]?.length;
                  const peer = peerAt.get(key(r, c));
                  const noted = marks?.has(cellMark(tab.name, r, c));
                  const v = vals[r]?.[c] ?? null;
                  const active = sel.r === r && sel.c === c;
                  const editing = active && edit && !edit.bar;
                  const align = f?.align ?? (isNumeric(v) && !(raw(r, c) && !raw(r, c).startsWith('=') && typeof literal(raw(r, c)) === 'string') ? 'right' : typeof v === 'boolean' ? 'center' : 'left');
                  return (
                    <td key={c} data-cell={`${r}-${c}`}
                      className={(inSel(r, c) ? 'is-in ' : '') + (active ? 'is-active ' : '') + (v instanceof Object && 'code' in (v as object) ? 'is-err ' : '') + (f?.wrap ? 'is-wrap ' : '') + (noted ? 'has-note' : '')}
                      style={{
                        textAlign: align, fontWeight: f?.b ? 700 : undefined, fontStyle: f?.i ? 'italic' : undefined,
                        textDecoration: [f?.u ? 'underline' : '', f?.s ? 'line-through' : ''].join(' ').trim() || undefined,
                        color: cs?.color || f?.color, background: cs?.bg || f?.bg || undefined,
                        ...(cs?.bold ? { fontWeight: 700 } : {}),
                        ...(peer && !active ? { boxShadow: `inset 0 0 0 2px ${peer.color}` } : {}),
                      }}
                      onMouseDown={(e) => cellDown(e, r, c)}
                      onMouseEnter={() => cellEnter(r, c)}
                      onDoubleClick={() => startEdit(raw(r, c))}
                    >
                      {editing ? (
                        <input ref={cellInput} className="sheet__cellinput" value={edit.value}
                          onChange={(e) => setEdit({ value: e.target.value, bar: false })}
                          onKeyDown={onEditKey}
                          onBlur={() => setTimeout(() => { if (document.activeElement !== cellInput.current && !document.activeElement?.closest('.sheet__grid')) finish(null); }, 120)}
                          spellCheck={false} autoCorrect="off" autoCapitalize="none" />
                      ) : showText(r, c)}
                      {peer && <span className="sheet__peertag" style={{ background: peer.color }}>{firstName(peer.name)}</span>}
                      {isFilterHead && !editing && (
                        <button className={'sheet__filterbtn' + (filtered ? ' is-on' : '')} aria-label={`Filter ${colName(c)}`}
                          onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); const b = (e.currentTarget as HTMLElement).getBoundingClientRect(); setFilterAt({ x: Math.max(8, Math.min(b.right - 240, window.innerWidth - 248)), y: b.bottom + 4 }); setFilterCol(filterCol === c ? null : c); }}>{filtered ? '⏷' : '▾'}</button>
                      )}
                      {isFilterHead && filterCol === c && (
                        <FilterMenu at={filterAt} col={c} vals={vals} from={r + 1} hidden={tab.filter!.hidden[String(c)] ?? []}
                          onSort={(dir) => { sortBy(dir, c, r + 1); setFilterCol(null); }}
                          onChange={(h) => mutate((t) => { if (t.filter) t.filter.hidden = { ...t.filter.hidden, [String(c)]: h }; })}
                          onClose={() => setFilterCol(null)} />
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <button className="sheet__more" onClick={() => setExtraRows((n) => n + 50)}>Add 50 more rows</button>
      </div>
      {hidden.size > 0 && <div className="sheet__filternote">{hidden.size} row{hidden.size === 1 ? '' : 's'} hidden by the filter · <button onClick={() => mutate((t) => { if (t.filter) t.filter.hidden = {}; })}>Show all</button></div>}

      <ChartsStrip charts={tab.charts ?? []} vals={vals} onChange={(charts) => mutate((t) => { t.charts = charts.length ? charts : undefined; })} />

      <div className="sheet__foot">
        <div className="sheet__tabs">
          <button className="sheet__tabadd" title="Add a sheet" onClick={addTab}>+</button>
          {tabs.map((t, i) => (
            <div key={i} className={'sheet__tab' + (i === ti ? ' is-on' : '')}>
              {renaming === i ? (
                <input autoFocus defaultValue={t.name} onBlur={(e) => renameTab(i, e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') renameTab(i, (e.target as HTMLInputElement).value); if (e.key === 'Escape') setRenaming(null); }} />
              ) : (
                <button onClick={() => { setTi(i); setSel({ r: 0, c: 0 }); setAnchor({ r: 0, c: 0 }); setEdit(null); }} onDoubleClick={() => setRenaming(i)}>{t.name}</button>
              )}
              {i === ti && renaming !== i && (
                <button className="sheet__tabmore" aria-label="Sheet options" onClick={() => setTabMenu(tabMenu === i ? null : i)}>▾</button>
              )}
              {tabMenu === i && (
                <div className="sheet__menu sheet__menu--up" onMouseLeave={() => setTabMenu(null)}>
                  <button onClick={() => { setRenaming(i); setTabMenu(null); }}>Rename</button>
                  <button onClick={() => { const c = clone(tabs); const copy = clone([tabs[i]])[0]; copy.name = `Copy of ${copy.name}`.slice(0, 40); c.splice(i + 1, 0, copy); commit(c); setTabMenu(null); setTi(i + 1); }}>Duplicate</button>
                  {i > 0 && <button onClick={() => { const c = clone(tabs); [c[i - 1], c[i]] = [c[i], c[i - 1]]; commit(c); setTi(i - 1); setTabMenu(null); }}>Move left</button>}
                  {i < tabs.length - 1 && <button onClick={() => { const c = clone(tabs); [c[i + 1], c[i]] = [c[i], c[i + 1]]; commit(c); setTi(i + 1); setTabMenu(null); }}>Move right</button>}
                  {tabs.length > 1 && <button className="is-danger" onClick={() => { commit(clone(tabs).filter((_, j) => j !== i)); setTi(Math.max(0, i - 1)); setTabMenu(null); }}>Delete</button>}
                </div>
              )}
            </div>
          ))}
        </div>
        <span className="sheet__readout">
          {nums.length > 1 ? `Sum: ${display(sum)} · Avg: ${display(sum / nums.length)} · Count: ${filled}` : multi ? `Count: ${filled}` : ''}
        </span>
      </div>
    </div>
  );
}
