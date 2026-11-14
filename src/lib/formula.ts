/** THE SPREADSHEET ENGINE (founder 2026-11-14: "make spreadsheets as smart as
 *  google spreadsheets"). A small, dependency-free formula evaluator: A1 refs,
 *  ranges, cross-tab refs ('Tab 2'!B3), the operators people type, and the
 *  ~70 functions most sheets actually use. Pure functions only — the editor
 *  calls computeSheets() on every change and renders the result.
 *
 *  Deliberately not here: array formulas/spill, named ranges, pivot tables,
 *  QUERY, charts. Errors read the Google way (#REF!, #DIV/0!, #NAME?, #VALUE!,
 *  #N/A, #CYCLE!). */

export interface CellFmt {
  b?: boolean; i?: boolean; u?: boolean; s?: boolean;
  align?: 'left' | 'center' | 'right';
  color?: string; bg?: string;
  num?: 'auto' | 'number' | 'currency' | 'percent' | 'date' | 'text';
  dec?: number;
  wrap?: boolean;
}
export interface SheetTab {
  name: string;
  cells: string[][];
  fmt?: Record<string, CellFmt>;
  colW?: number[];
  frozen?: number;
}

export class FErr { constructor(public code: string) {} toString() { return this.code; } }
export class DateVal { constructor(public n: number) {} }
type Scalar = number | string | boolean | FErr | DateVal | null;
type Range = { range: Scalar[][] };
type Val = Scalar | Range;

const isRange = (v: unknown): v is Range => !!v && typeof v === 'object' && 'range' in (v as object);
const ERR = (c: string) => new FErr(c);

// ── A1 helpers ─────────────────────────────────────────────────────────────
export function colName(c: number): string {
  let s = ''; c += 1;
  while (c > 0) { const m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = Math.floor((c - 1) / 26); }
  return s;
}
export function colIndex(name: string): number {
  let n = 0;
  for (const ch of name.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}
export const a1 = (r: number, c: number) => `${colName(c)}${r + 1}`;
export function parseA1(s: string): { r: number; c: number } | null {
  const m = /^\$?([A-Za-z]{1,3})\$?(\d{1,6})$/.exec(s.trim());
  if (!m) return null;
  return { r: Number(m[2]) - 1, c: colIndex(m[1]) };
}

// ── Dates: Google/Excel serials (days since 1899-12-30) ───────────────────
const EPOCH = Date.UTC(1899, 11, 30);
export const toSerial = (d: Date) => (Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - EPOCH) / 86400000
  + (d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds()) / 86400;
export const fromSerial = (n: number) => { const ms = EPOCH + Math.round(n * 86400000); const u = new Date(ms); return new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate(), u.getUTCHours(), u.getUTCMinutes()); };

/** A typed literal: numbers (commas, $, %), booleans, dates; else text. */
export function literal(raw: string): Scalar {
  const t = raw.trim();
  if (t === '') return null;
  const num = /^\(?-?\$?\s?-?[\d,]*\.?\d+(e[+-]?\d+)?\)?%?$/i;
  if (num.test(t) && /\d/.test(t)) {
    const neg = t.startsWith('(') && t.endsWith(')');
    let n = Number(t.replace(/[(),$\s%]/g, ''));
    if (!isNaN(n)) { if (t.endsWith('%')) n /= 100; return neg ? -n : n; }
  }
  if (/^true$/i.test(t)) return true;
  if (/^false$/i.test(t)) return false;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (m) return new DateVal(toSerial(new Date(+m[1], +m[2] - 1, +m[3])));
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(t);
  if (m) { const y = +m[3] < 100 ? 2000 + +m[3] : +m[3]; return new DateVal(toSerial(new Date(y, +m[1] - 1, +m[2]))); }
  return raw;
}

// ── Tokenizer ──────────────────────────────────────────────────────────────
type Tok =
  | { t: 'num'; v: number } | { t: 'str'; v: string } | { t: 'bool'; v: boolean }
  | { t: 'ref'; sheet?: string; v: string; raw: string } | { t: 'id'; v: string }
  | { t: 'op'; v: string } | { t: '(' } | { t: ')' } | { t: ',' } | { t: 'err'; v: string };

const REF_RE = /^(?:('(?:[^']|'')+'|[A-Za-z_][\w.]*)!)?(\$?[A-Za-z]{1,3}\$?\d{1,6})(?![\w(])/;

export function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === '"') {
      let j = i + 1, s = '';
      while (j < src.length) { if (src[j] === '"') { if (src[j + 1] === '"') { s += '"'; j += 2; continue; } break; } s += src[j++]; }
      out.push({ t: 'str', v: s }); i = j + 1; continue;
    }
    if (/[0-9.]/.test(ch)) {
      const m = /^\d*\.?\d+(e[+-]?\d+)?/i.exec(src.slice(i));
      if (m) { out.push({ t: 'num', v: Number(m[0]) }); i += m[0].length; continue; }
    }
    if (ch === '#') {
      const m = /^#(REF!|DIV\/0!|NAME\?|VALUE!|N\/A|NUM!|CYCLE!)/.exec(src.slice(i));
      if (m) { out.push({ t: 'err', v: m[0] }); i += m[0].length; continue; }
    }
    const rest = src.slice(i);
    const rm = REF_RE.exec(rest);
    if (rm && (ch === "'" || /[A-Za-z$]/.test(ch))) {
      let sheet = rm[1];
      if (sheet?.startsWith("'")) sheet = sheet.slice(1, -1).replace(/''/g, "'");
      out.push({ t: 'ref', sheet: sheet || undefined, v: rm[2], raw: rm[0] });
      i += rm[0].length; continue;
    }
    const idm = /^[A-Za-z_][\w.]*/.exec(rest);
    if (idm) {
      const w = idm[0].toUpperCase();
      if (w === 'TRUE' || w === 'FALSE') out.push({ t: 'bool', v: w === 'TRUE' });
      else out.push({ t: 'id', v: w });
      i += idm[0].length; continue;
    }
    const two = src.slice(i, i + 2);
    if (two === '<=' || two === '>=' || two === '<>') { out.push({ t: 'op', v: two }); i += 2; continue; }
    if ('+-*/^&=<>%:'.includes(ch)) { out.push({ t: 'op', v: ch }); i++; continue; }
    if (ch === '(') { out.push({ t: '(' }); i++; continue; }
    if (ch === ')') { out.push({ t: ')' }); i++; continue; }
    if (ch === ',' || ch === ';') { out.push({ t: ',' }); i++; continue; }
    throw new Error('bad char');
  }
  return out;
}

// ── Parser → AST ───────────────────────────────────────────────────────────
type Node =
  | { k: 'lit'; v: Scalar } | { k: 'ref'; sheet?: string; r: number; c: number }
  | { k: 'range'; sheet?: string; r1: number; c1: number; r2: number; c2: number }
  | { k: 'un'; op: string; a: Node } | { k: 'pct'; a: Node }
  | { k: 'bin'; op: string; a: Node; b: Node } | { k: 'fn'; name: string; args: Node[] };

function parse(toks: Tok[]): Node {
  let p = 0;
  const peek = () => toks[p];
  const isOp = (v: string) => { const t = peek(); return !!t && t.t === 'op' && t.v === v; };
  const expr = (): Node => cmp();
  const cmp = (): Node => {
    let a = cat();
    while (peek()?.t === 'op' && ['=', '<>', '<', '>', '<=', '>='].includes((peek() as { v: string }).v)) {
      const op = (toks[p++] as { v: string }).v; a = { k: 'bin', op, a, b: cat() };
    }
    return a;
  };
  const cat = (): Node => { let a = add(); while (isOp('&')) { p++; a = { k: 'bin', op: '&', a, b: add() }; } return a; };
  const add = (): Node => { let a = mul(); while (isOp('+') || isOp('-')) { const op = (toks[p++] as { v: string }).v; a = { k: 'bin', op, a, b: mul() }; } return a; };
  const mul = (): Node => { let a = pow(); while (isOp('*') || isOp('/')) { const op = (toks[p++] as { v: string }).v; a = { k: 'bin', op, a, b: pow() }; } return a; };
  const pow = (): Node => { let a = unary(); while (isOp('^')) { p++; a = { k: 'bin', op: '^', a, b: unary() }; } return a; };
  const unary = (): Node => {
    if (isOp('-')) { p++; return { k: 'un', op: '-', a: unary() }; }
    if (isOp('+')) { p++; return unary(); }
    let a = prim();
    while (isOp('%')) { p++; a = { k: 'pct', a }; }
    return a;
  };
  const prim = (): Node => {
    const t = toks[p++];
    if (!t) throw new Error('end');
    if (t.t === 'num') return { k: 'lit', v: t.v };
    if (t.t === 'str') return { k: 'lit', v: t.v };
    if (t.t === 'bool') return { k: 'lit', v: t.v };
    if (t.t === 'err') return { k: 'lit', v: ERR(t.v) };
    if (t.t === '(') { const e = expr(); if (peek()?.t !== ')') throw new Error(')'); p++; return e; }
    if (t.t === 'ref') {
      const a = parseA1(t.v)!;
      if (isOp(':') && toks[p + 1]?.t === 'ref') {
        p++; const b = parseA1((toks[p++] as { v: string }).v)!;
        return { k: 'range', sheet: t.sheet, r1: Math.min(a.r, b.r), c1: Math.min(a.c, b.c), r2: Math.max(a.r, b.r), c2: Math.max(a.c, b.c) };
      }
      return { k: 'ref', sheet: t.sheet, r: a.r, c: a.c };
    }
    if (t.t === 'id') {
      // Whole columns: A:A, B:D
      if (isOp(':') && /^[A-Z]{1,3}$/.test(t.v) && toks[p + 1]?.t === 'id') {
        p++; const b = (toks[p++] as { v: string }).v;
        const c1 = colIndex(t.v), c2 = colIndex(b);
        return { k: 'range', r1: 0, c1: Math.min(c1, c2), r2: 9999, c2: Math.max(c1, c2) };
      }
      if (peek()?.t !== '(') return { k: 'lit', v: ERR('#NAME?') };
      p++;
      const args: Node[] = [];
      if (peek()?.t !== ')') {
        for (;;) {
          if (peek()?.t === ',' ) { args.push({ k: 'lit', v: null }); p++; continue; }
          args.push(expr());
          if (peek()?.t === ',') { p++; continue; }
          break;
        }
      }
      if (peek()?.t !== ')') throw new Error(')');
      p++;
      return { k: 'fn', name: t.v.replace(/^_XLFN\./, ''), args };
    }
    throw new Error('unexpected');
  };
  const n = expr();
  if (p < toks.length) throw new Error('trailing');
  return n;
}

// ── Coercion ───────────────────────────────────────────────────────────────
function num(v: Scalar): number | FErr {
  if (v instanceof FErr) return v;
  if (v instanceof DateVal) return v.n;
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  const l = literal(v);
  if (typeof l === 'number') return l;
  if (l instanceof DateVal) return l.n;
  return ERR('#VALUE!');
}
function str(v: Scalar): string {
  if (v == null) return '';
  if (v instanceof FErr) return v.code;
  if (v instanceof DateVal) return formatDate(v.n);
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'number') return String(Math.round(v * 1e10) / 1e10);
  return v;
}
function bool(v: Scalar): boolean | FErr {
  if (v instanceof FErr) return v;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') { if (/^true$/i.test(v)) return true; if (/^false$/i.test(v) || v === '') return false; return ERR('#VALUE!'); }
  return num(v) !== 0;
}
const scalar = (v: Val): Scalar => (isRange(v) ? (v.range[0]?.[0] ?? null) : v);
const flat = (v: Val): Scalar[] => (isRange(v) ? v.range.flat() : [v]);

function formatDate(n: number) {
  const d = fromSerial(n);
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}

// ── Criteria (SUMIF/COUNTIF) ───────────────────────────────────────────────
function matcher(crit: Scalar): (v: Scalar) => boolean {
  if (typeof crit === 'number' || typeof crit === 'boolean') return (v) => (typeof v === 'number' || typeof v === 'boolean' ? v === crit : str(v).toLowerCase() === str(crit).toLowerCase());
  const s = str(crit);
  const m = /^(<=|>=|<>|<|>|=)?(.*)$/.exec(s)!;
  const op = m[1] ?? '=';
  const rhs = m[2];
  const rn = literal(rhs);
  const rnum = typeof rn === 'number' ? rn : rn instanceof DateVal ? rn.n : null;
  const wild = /[*?]/.test(rhs) ? new RegExp('^' + rhs.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i') : null;
  return (v) => {
    if (rnum != null && op !== '=' && op !== '<>') {
      const x = num(v); if (x instanceof FErr || v == null || v === '') return false;
      return op === '<' ? x < rnum : op === '>' ? x > rnum : op === '<=' ? x <= rnum : x >= rnum;
    }
    let eq: boolean;
    if (rnum != null && (typeof v === 'number' || v instanceof DateVal)) eq = num(v) === rnum;
    else if (wild) eq = wild.test(str(v));
    else eq = str(v).toLowerCase() === rhs.toLowerCase();
    return op === '<>' ? !eq : eq;
  };
}

// ── Evaluation ─────────────────────────────────────────────────────────────
export interface Computed { values: Scalar[][]; }

export function computeSheets(tabs: SheetTab[]): Computed[] {
  const byName = new Map(tabs.map((t, i) => [t.name.toLowerCase(), i]));
  const cache = tabs.map(() => new Map<string, Scalar>());
  const busy = new Set<string>();

  const cellVal = (ti: number, r: number, c: number): Scalar => {
    const key = `${r},${c}`;
    const hit = cache[ti].get(key);
    if (hit !== undefined) return hit;
    const raw = tabs[ti].cells[r]?.[c] ?? '';
    if (!raw.startsWith('=')) { const v = literal(raw); cache[ti].set(key, v); return v; }
    const id = `${ti}:${key}`;
    if (busy.has(id)) return ERR('#CYCLE!');
    busy.add(id);
    let v: Scalar;
    try {
      const ast = parse(tokenize(raw.slice(1)));
      const out = ev(ast, ti);
      v = scalar(out);
      if (v === null) v = 0;
    } catch { v = ERR('#ERROR!'); }
    busy.delete(id);
    cache[ti].set(key, v);
    return v;
  };

  const tabOf = (sheet: string | undefined, here: number) => {
    if (!sheet) return here;
    const i = byName.get(sheet.toLowerCase());
    return i == null ? -1 : i;
  };

  const ev = (n: Node, ti: number): Val => {
    switch (n.k) {
      case 'lit': return n.v;
      case 'ref': { const t = tabOf(n.sheet, ti); if (t < 0) return ERR('#REF!'); return cellVal(t, n.r, n.c); }
      case 'range': {
        const t = tabOf(n.sheet, ti); if (t < 0) return ERR('#REF!');
        const rows = tabs[t].cells.length;
        const r2 = Math.min(n.r2, Math.max(rows - 1, n.r1));
        const out: Scalar[][] = [];
        for (let r = n.r1; r <= r2; r++) { const row: Scalar[] = []; for (let c = n.c1; c <= n.c2; c++) row.push(cellVal(t, r, c)); out.push(row); }
        return { range: out };
      }
      case 'un': { const x = num(scalar(ev(n.a, ti))); return x instanceof FErr ? x : -x; }
      case 'pct': { const x = num(scalar(ev(n.a, ti))); return x instanceof FErr ? x : x / 100; }
      case 'bin': {
        const A = scalar(ev(n.a, ti)), B = scalar(ev(n.b, ti));
        if (A instanceof FErr) return A; if (B instanceof FErr) return B;
        if (n.op === '&') return str(A) + str(B);
        if (['=', '<>', '<', '>', '<=', '>='].includes(n.op)) {
          let c: number;
          const an = typeof A === 'number' || A instanceof DateVal || typeof A === 'boolean';
          const bn = typeof B === 'number' || B instanceof DateVal || typeof B === 'boolean';
          if ((an || A == null) && (bn || B == null)) c = (num(A) as number) - (num(B) as number);
          else c = str(A).toLowerCase().localeCompare(str(B).toLowerCase());
          return n.op === '=' ? c === 0 : n.op === '<>' ? c !== 0 : n.op === '<' ? c < 0 : n.op === '>' ? c > 0 : n.op === '<=' ? c <= 0 : c >= 0;
        }
        const x = num(A), y = num(B);
        if (x instanceof FErr) return x; if (y instanceof FErr) return y;
        const dateA = A instanceof DateVal, dateB = B instanceof DateVal;
        switch (n.op) {
          case '+': return dateA || dateB ? new DateVal(x + y) : x + y;
          case '-': return dateA && !dateB ? new DateVal(x - y) : x - y;
          case '*': return x * y;
          case '/': return y === 0 ? ERR('#DIV/0!') : x / y;
          case '^': return Math.pow(x, y);
        }
        return ERR('#VALUE!');
      }
      case 'fn': return call(n.name, n.args, ti);
    }
  };

  const nums = (args: Node[], ti: number, strict = false): number[] | FErr => {
    const out: number[] = [];
    for (const a of args) {
      const v = ev(a, ti);
      if (isRange(v)) { for (const x of v.range.flat()) { if (x instanceof FErr) return x; if (typeof x === 'number') out.push(x); else if (x instanceof DateVal) out.push(x.n); } }
      else { if (v instanceof FErr) return v; if (v == null) continue; const x = num(v); if (x instanceof FErr) { if (strict) return x; continue; } out.push(x); }
    }
    return out;
  };

  const call = (name: string, args: Node[], ti: number): Val => {
    const A = (i: number) => (args[i] ? ev(args[i], ti) : null);
    const S = (i: number) => scalar(A(i));
    const N = (i: number, d?: number) => { if (!args[i] && d != null) return d; return num(S(i)); };
    const T = (i: number) => str(S(i));
    const agg = (f: (xs: number[]) => Scalar) => { const xs = nums(args, ti); return xs instanceof FErr ? xs : f(xs); };
    const ifs = (rangeIdx: number, critIdx: number) => {
      const rng = A(rangeIdx); const m = matcher(S(critIdx));
      return { cells: flat(rng as Val), m };
    };
    switch (name) {
      case 'SUM': return agg((xs) => xs.reduce((a, b) => a + b, 0));
      case 'AVERAGE': return agg((xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : ERR('#DIV/0!')));
      case 'MIN': return agg((xs) => (xs.length ? Math.min(...xs) : 0));
      case 'MAX': return agg((xs) => (xs.length ? Math.max(...xs) : 0));
      case 'PRODUCT': return agg((xs) => xs.reduce((a, b) => a * b, 1));
      case 'MEDIAN': return agg((xs) => { if (!xs.length) return ERR('#NUM!'); const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; });
      case 'STDEV': return agg((xs) => { if (xs.length < 2) return ERR('#DIV/0!'); const mu = xs.reduce((a, b) => a + b, 0) / xs.length; return Math.sqrt(xs.reduce((a, b) => a + (b - mu) ** 2, 0) / (xs.length - 1)); });
      case 'COUNT': { let n = 0; for (const a of args) for (const x of flat(ev(a, ti))) if (typeof x === 'number' || x instanceof DateVal) n++; return n; }
      case 'COUNTA': { let n = 0; for (const a of args) for (const x of flat(ev(a, ti))) if (x != null && x !== '') n++; return n; }
      case 'COUNTBLANK': { let n = 0; for (const x of flat(A(0) as Val)) if (x == null || x === '') n++; return n; }
      case 'SUMIF': case 'AVERAGEIF': {
        const { cells, m } = ifs(0, 1);
        const sumCells = args[2] ? flat(A(2) as Val) : cells;
        const hits: number[] = [];
        cells.forEach((v, i) => { if (m(v)) { const x = num(sumCells[i] ?? null); if (!(x instanceof FErr)) hits.push(x); } });
        if (name === 'SUMIF') return hits.reduce((a, b) => a + b, 0);
        return hits.length ? hits.reduce((a, b) => a + b, 0) / hits.length : ERR('#DIV/0!');
      }
      case 'COUNTIF': { const { cells, m } = ifs(0, 1); return cells.filter(m).length; }
      case 'SUMIFS': case 'COUNTIFS': case 'AVERAGEIFS': {
        const start = name === 'COUNTIFS' ? 0 : 1;
        const base = name === 'COUNTIFS' ? flat(A(0) as Val) : flat(A(0) as Val);
        const ok = base.map(() => true);
        for (let i = start; i + 1 < args.length; i += 2) {
          const cells = flat(A(i) as Val); const m = matcher(S(i + 1));
          cells.forEach((v, j) => { if (!m(v)) ok[j] = false; });
        }
        if (name === 'COUNTIFS') return ok.filter(Boolean).length;
        const hits = base.filter((_, j) => ok[j]).map((v) => num(v)).filter((x): x is number => typeof x === 'number');
        if (name === 'SUMIFS') return hits.reduce((a, b) => a + b, 0);
        return hits.length ? hits.reduce((a, b) => a + b, 0) / hits.length : ERR('#DIV/0!');
      }
      case 'IF': { const c = bool(S(0)); if (c instanceof FErr) return c; return c ? (args[1] ? A(1) : true) : (args[2] ? A(2) : false); }
      case 'IFS': { for (let i = 0; i + 1 < args.length; i += 2) { const c = bool(S(i)); if (c instanceof FErr) return c; if (c) return A(i + 1); } return ERR('#N/A'); }
      case 'IFERROR': { const v = S(0); return v instanceof FErr ? A(1) : A(0); }
      case 'IFNA': { const v = S(0); return v instanceof FErr && v.code === '#N/A' ? A(1) : A(0); }
      case 'SWITCH': { const x = S(0); for (let i = 1; i + 1 < args.length; i += 2) if (str(S(i)).toLowerCase() === str(x).toLowerCase()) return A(i + 1); return args.length % 2 === 0 ? A(args.length - 1) : ERR('#N/A'); }
      case 'AND': case 'OR': case 'XOR': {
        const bs: boolean[] = [];
        for (const a of args) for (const x of flat(ev(a, ti))) { if (x == null || x === '') continue; const b = bool(x); if (b instanceof FErr) return b; bs.push(b); }
        return name === 'AND' ? bs.every(Boolean) : name === 'OR' ? bs.some(Boolean) : bs.filter(Boolean).length % 2 === 1;
      }
      case 'NOT': { const b = bool(S(0)); return b instanceof FErr ? b : !b; }
      case 'ROUND': case 'ROUNDUP': case 'ROUNDDOWN': {
        const x = N(0), d = N(1, 0); if (x instanceof FErr) return x; if (d instanceof FErr) return d;
        const f = Math.pow(10, d); const fn = name === 'ROUND' ? Math.round : name === 'ROUNDUP' ? (v: number) => Math.sign(v) * Math.ceil(Math.abs(v)) : (v: number) => Math.sign(v) * Math.floor(Math.abs(v));
        return fn(x * f) / f;
      }
      case 'INT': { const x = N(0); return x instanceof FErr ? x : Math.floor(x); }
      case 'ABS': { const x = N(0); return x instanceof FErr ? x : Math.abs(x); }
      case 'SQRT': { const x = N(0); return x instanceof FErr ? x : x < 0 ? ERR('#NUM!') : Math.sqrt(x); }
      case 'POWER': { const x = N(0), y = N(1); return x instanceof FErr ? x : y instanceof FErr ? y : Math.pow(x, y); }
      case 'MOD': { const x = N(0), y = N(1); if (x instanceof FErr) return x; if (y instanceof FErr) return y; return y === 0 ? ERR('#DIV/0!') : x - y * Math.floor(x / y); }
      case 'CEILING': case 'FLOOR': { const x = N(0), s = N(1, 1); if (x instanceof FErr) return x; if (s instanceof FErr) return s; if (s === 0) return 0; return (name === 'CEILING' ? Math.ceil(x / s) : Math.floor(x / s)) * s; }
      case 'PI': return Math.PI;
      case 'RAND': return Math.random();
      case 'RANDBETWEEN': { const lo = N(0), hi = N(1); if (lo instanceof FErr) return lo; if (hi instanceof FErr) return hi; return Math.floor(lo + Math.random() * (hi - lo + 1)); }
      case 'CONCAT': case 'CONCATENATE': { let s = ''; for (const a of args) for (const x of flat(ev(a, ti))) s += str(x); return s; }
      case 'TEXTJOIN': { const sep = T(0); const skip = bool(S(1)); const parts: string[] = []; for (const a of args.slice(2)) for (const x of flat(ev(a, ti))) { const s = str(x); if (skip === true && s === '') continue; parts.push(s); } return parts.join(sep); }
      case 'LEN': return T(0).length;
      case 'UPPER': return T(0).toUpperCase();
      case 'LOWER': return T(0).toLowerCase();
      case 'PROPER': return T(0).toLowerCase().replace(/\b\w/g, (m) => m.toUpperCase());
      case 'TRIM': return T(0).trim().replace(/\s+/g, ' ');
      case 'LEFT': { const n = N(1, 1); return n instanceof FErr ? n : T(0).slice(0, n); }
      case 'RIGHT': { const n = N(1, 1); return n instanceof FErr ? n : (n === 0 ? '' : T(0).slice(-n)); }
      case 'MID': { const s = N(1), n = N(2); if (s instanceof FErr) return s; if (n instanceof FErr) return n; return T(0).substr(s - 1, n); }
      case 'SUBSTITUTE': return T(0).split(T(1)).join(T(2));
      case 'REPLACE': { const s = N(1), n = N(2); if (s instanceof FErr) return s; if (n instanceof FErr) return n; const t = T(0); return t.slice(0, s - 1) + T(3) + t.slice(s - 1 + n); }
      case 'REPT': { const n = N(1); return n instanceof FErr ? n : T(0).repeat(Math.max(0, n)); }
      case 'FIND': case 'SEARCH': { const hay = name === 'SEARCH' ? T(1).toLowerCase() : T(1); const need = name === 'SEARCH' ? T(0).toLowerCase() : T(0); const at = hay.indexOf(need, (N(2, 1) as number) - 1); return at < 0 ? ERR('#VALUE!') : at + 1; }
      case 'EXACT': return T(0) === T(1);
      case 'VALUE': { const x = num(S(0)); return x; }
      case 'TEXT': {
        const v = S(0), f = T(1);
        const x = num(v); if (x instanceof FErr) return str(v);
        if (/[dmy]/i.test(f) && !/0/.test(f)) { const d = fromSerial(x); const pad = (k: number) => String(k).padStart(2, '0'); return f.replace(/yyyy/gi, String(d.getFullYear())).replace(/yy/gi, String(d.getFullYear()).slice(2)).replace(/mm/g, pad(d.getMonth() + 1)).replace(/dd/gi, pad(d.getDate())).replace(/\bm\b/g, String(d.getMonth() + 1)).replace(/\bd\b/gi, String(d.getDate())); }
        const pct = f.includes('%'); const dec = (f.split('.')[1] ?? '').replace(/[^0#]/g, '').length;
        const n = pct ? x * 100 : x;
        const body = n.toLocaleString(undefined, { minimumFractionDigits: dec, maximumFractionDigits: dec, useGrouping: f.includes(',') });
        return (f.includes('$') ? '$' : '') + body + (pct ? '%' : '');
      }
      case 'TODAY': return new DateVal(Math.floor(toSerial(new Date())));
      case 'NOW': return new DateVal(toSerial(new Date()));
      case 'DATE': { const y = N(0), m = N(1), d = N(2); if (y instanceof FErr) return y; if (m instanceof FErr) return m; if (d instanceof FErr) return d; return new DateVal(toSerial(new Date(y, m - 1, d))); }
      case 'YEAR': case 'MONTH': case 'DAY': case 'WEEKDAY': {
        const x = num(S(0)); if (x instanceof FErr) return x; const d = fromSerial(x);
        return name === 'YEAR' ? d.getFullYear() : name === 'MONTH' ? d.getMonth() + 1 : name === 'DAY' ? d.getDate() : d.getDay() + 1;
      }
      case 'DAYS': { const e = num(S(0)), s = num(S(1)); if (e instanceof FErr) return e; if (s instanceof FErr) return s; return Math.floor(e) - Math.floor(s); }
      case 'EDATE': { const x = num(S(0)), m = N(1); if (x instanceof FErr) return x; if (m instanceof FErr) return m; const d = fromSerial(x); return new DateVal(toSerial(new Date(d.getFullYear(), d.getMonth() + m, d.getDate()))); }
      case 'NETWORKDAYS': {
        const s = num(S(0)), e = num(S(1)); if (s instanceof FErr) return s; if (e instanceof FErr) return e;
        let n = 0; for (let k = Math.floor(Math.min(s, e)); k <= Math.floor(Math.max(s, e)); k++) { const wd = fromSerial(k).getDay(); if (wd !== 0 && wd !== 6) n++; } return n;
      }
      case 'ISBLANK': { const v = S(0); return v == null || v === ''; }
      case 'ISNUMBER': { const v = S(0); return typeof v === 'number' || v instanceof DateVal; }
      case 'ISTEXT': return typeof S(0) === 'string' && S(0) !== '';
      case 'ISERROR': return S(0) instanceof FErr;
      case 'ISNA': { const v = S(0); return v instanceof FErr && v.code === '#N/A'; }
      case 'VLOOKUP': case 'HLOOKUP': {
        const key = S(0); const tbl = A(1); const idx = N(2); const approx = args[3] ? bool(S(3)) : true;
        if (!isRange(tbl)) return ERR('#REF!'); if (idx instanceof FErr) return idx;
        const rows = name === 'VLOOKUP' ? tbl.range : (tbl.range[0] ?? []).map((_, c) => tbl.range.map((r) => r[c]));
        const keyStr = str(key).toLowerCase(); const keyNum = num(key);
        let hit = -1;
        if (approx === true && typeof keyNum === 'number' && typeof key !== 'string') {
          rows.forEach((r, i) => { const x = num(r[0]); if (typeof x === 'number' && x <= keyNum) hit = i; });
        } else hit = rows.findIndex((r) => str(r[0]).toLowerCase() === keyStr);
        if (hit < 0) return ERR('#N/A');
        const v = rows[hit][idx - 1]; return v === undefined ? ERR('#REF!') : v;
      }
      case 'MATCH': {
        const key = S(0); const cells = flat(A(1) as Val); const mode = N(2, 1);
        const ks = str(key).toLowerCase();
        if (mode === 0) { const i = cells.findIndex((c) => str(c).toLowerCase() === ks); return i < 0 ? ERR('#N/A') : i + 1; }
        const kn = num(key); if (kn instanceof FErr) return ERR('#N/A');
        let hit = -1; cells.forEach((c, i) => { const x = num(c); if (typeof x === 'number' && (mode === 1 ? x <= kn : x >= kn)) hit = i; });
        return hit < 0 ? ERR('#N/A') : hit + 1;
      }
      case 'INDEX': {
        const t = A(0); const r = N(1, 1), c = N(2, 1); if (r instanceof FErr) return r; if (c instanceof FErr) return c;
        if (!isRange(t)) return r <= 1 && c <= 1 ? t : ERR('#REF!');
        const rows = t.range; const row = rows.length === 1 && args.length === 2 ? rows[0] : rows[(r || 1) - 1];
        if (!row) return ERR('#REF!');
        const v = rows.length === 1 && args.length === 2 ? row[(r || 1) - 1] : row[(c || 1) - 1];
        return v === undefined ? ERR('#REF!') : v;
      }
      case 'XLOOKUP': {
        const key = str(S(0)).toLowerCase(); const look = flat(A(1) as Val); const ret = flat(A(2) as Val);
        const i = look.findIndex((x) => str(x).toLowerCase() === key);
        if (i < 0) return args[3] ? A(3) : ERR('#N/A');
        return ret[i] ?? ERR('#REF!');
      }
      case 'ROWS': { const t = A(0); return isRange(t) ? t.range.length : 1; }
      case 'COLUMNS': { const t = A(0); return isRange(t) ? (t.range[0]?.length ?? 0) : 1; }
      case 'PMT': {
        const rate = N(0), n = N(1), pv = N(2), fv = N(3, 0); if ([rate, n, pv, fv].some((x) => x instanceof FErr)) return ERR('#VALUE!');
        const r = rate as number, k = n as number, p = pv as number, f = fv as number;
        if (r === 0) return -(p + f) / k;
        return -(r * (p * Math.pow(1 + r, k) + f)) / (Math.pow(1 + r, k) - 1);
      }
    }
    return ERR('#NAME?');
  };

  return tabs.map((t, ti) => {
    const rows = t.cells.length;
    const cols = Math.max(0, ...t.cells.map((r) => r.length));
    const values: Scalar[][] = [];
    for (let r = 0; r < rows; r++) { const row: Scalar[] = []; for (let c = 0; c < cols; c++) row.push(cellVal(ti, r, c)); values.push(row); }
    return { values };
  });
}

/** Every function the engine knows — the formula bar's autocomplete. */
export const FUNCTIONS: { name: string; hint: string }[] = [
  ['SUM', 'SUM(range) — adds numbers'], ['AVERAGE', 'AVERAGE(range)'], ['MIN', 'MIN(range)'], ['MAX', 'MAX(range)'],
  ['COUNT', 'COUNT(range) — counts numbers'], ['COUNTA', 'COUNTA(range) — counts non-empty'], ['COUNTBLANK', 'COUNTBLANK(range)'],
  ['COUNTIF', 'COUNTIF(range, ">5")'], ['COUNTIFS', 'COUNTIFS(range1, crit1, …)'], ['SUMIF', 'SUMIF(range, crit, [sum_range])'],
  ['SUMIFS', 'SUMIFS(sum_range, range1, crit1, …)'], ['AVERAGEIF', 'AVERAGEIF(range, crit, [avg_range])'], ['AVERAGEIFS', 'AVERAGEIFS(avg_range, range1, crit1, …)'],
  ['IF', 'IF(test, if_true, if_false)'], ['IFS', 'IFS(test1, value1, …)'], ['IFERROR', 'IFERROR(value, fallback)'], ['IFNA', 'IFNA(value, fallback)'], ['SWITCH', 'SWITCH(expr, case1, value1, …, [default])'],
  ['AND', 'AND(a, b, …)'], ['OR', 'OR(a, b, …)'], ['NOT', 'NOT(a)'], ['XOR', 'XOR(a, b, …)'],
  ['ROUND', 'ROUND(n, [places])'], ['ROUNDUP', 'ROUNDUP(n, [places])'], ['ROUNDDOWN', 'ROUNDDOWN(n, [places])'], ['INT', 'INT(n)'], ['ABS', 'ABS(n)'],
  ['SQRT', 'SQRT(n)'], ['POWER', 'POWER(n, p)'], ['MOD', 'MOD(n, d)'], ['CEILING', 'CEILING(n, [step])'], ['FLOOR', 'FLOOR(n, [step])'],
  ['PRODUCT', 'PRODUCT(range)'], ['MEDIAN', 'MEDIAN(range)'], ['STDEV', 'STDEV(range)'], ['PI', 'PI()'], ['RAND', 'RAND()'], ['RANDBETWEEN', 'RANDBETWEEN(lo, hi)'],
  ['CONCAT', 'CONCAT(a, b, …)'], ['CONCATENATE', 'CONCATENATE(a, b, …)'], ['TEXTJOIN', 'TEXTJOIN(sep, skip_empty, range…)'],
  ['LEN', 'LEN(text)'], ['UPPER', 'UPPER(text)'], ['LOWER', 'LOWER(text)'], ['PROPER', 'PROPER(text)'], ['TRIM', 'TRIM(text)'],
  ['LEFT', 'LEFT(text, [n])'], ['RIGHT', 'RIGHT(text, [n])'], ['MID', 'MID(text, start, n)'], ['SUBSTITUTE', 'SUBSTITUTE(text, old, new)'],
  ['REPLACE', 'REPLACE(text, start, n, new)'], ['REPT', 'REPT(text, n)'], ['FIND', 'FIND(needle, text)'], ['SEARCH', 'SEARCH(needle, text)'], ['EXACT', 'EXACT(a, b)'],
  ['VALUE', 'VALUE(text)'], ['TEXT', 'TEXT(n, "$#,##0.00")'],
  ['TODAY', 'TODAY()'], ['NOW', 'NOW()'], ['DATE', 'DATE(y, m, d)'], ['YEAR', 'YEAR(date)'], ['MONTH', 'MONTH(date)'], ['DAY', 'DAY(date)'], ['WEEKDAY', 'WEEKDAY(date)'],
  ['DAYS', 'DAYS(end, start)'], ['EDATE', 'EDATE(date, months)'], ['NETWORKDAYS', 'NETWORKDAYS(start, end)'],
  ['ISBLANK', 'ISBLANK(v)'], ['ISNUMBER', 'ISNUMBER(v)'], ['ISTEXT', 'ISTEXT(v)'], ['ISERROR', 'ISERROR(v)'], ['ISNA', 'ISNA(v)'],
  ['VLOOKUP', 'VLOOKUP(key, range, col, [sorted])'], ['HLOOKUP', 'HLOOKUP(key, range, row, [sorted])'], ['XLOOKUP', 'XLOOKUP(key, look, return, [if_missing])'],
  ['MATCH', 'MATCH(key, range, [0])'], ['INDEX', 'INDEX(range, row, [col])'], ['ROWS', 'ROWS(range)'], ['COLUMNS', 'COLUMNS(range)'],
  ['PMT', 'PMT(rate, periods, present_value)'],
].map(([name, hint]) => ({ name, hint }));

/** How a computed value READS in its cell, honoring the cell's number format. */
export function display(v: Scalar, f?: CellFmt): string {
  if (v == null) return '';
  if (v instanceof FErr) return v.code;
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  const kind = f?.num ?? 'auto';
  if (kind === 'text') return typeof v === 'number' ? String(v) : str(v);
  if (v instanceof DateVal && (kind === 'auto' || kind === 'date')) {
    const d = fromSerial(v.n); const base = `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
    return v.n % 1 ? `${base} ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}` : base;
  }
  const n = v instanceof DateVal ? v.n : v;
  if (typeof n !== 'number') return n;
  if (kind === 'date') return formatDate(n);
  const dec = f?.dec;
  if (kind === 'currency') return (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: dec ?? 2, maximumFractionDigits: dec ?? 2 });
  if (kind === 'percent') return (n * 100).toLocaleString(undefined, { minimumFractionDigits: dec ?? 0, maximumFractionDigits: dec ?? 2 }) + '%';
  if (kind === 'number') return n.toLocaleString(undefined, { minimumFractionDigits: dec ?? 2, maximumFractionDigits: dec ?? 2 });
  if (dec != null) return n.toFixed(dec);
  return String(Math.round(n * 1e10) / 1e10);
}
export const isNumeric = (v: Scalar) => typeof v === 'number' || v instanceof DateVal;
export type { Scalar };

// ── Formula rewriting: insert/delete rows/cols, and copy/paste offsets ─────
function rewriteRefs(formula: string, fn: (ref: { sheet?: string; r: number; c: number; absR: boolean; absC: boolean }) => string | null): string {
  if (!formula.startsWith('=')) return formula;
  let out = '=';
  const src = formula.slice(1);
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '"') { const j = src.indexOf('"', i + 1); const end = j < 0 ? src.length : j + 1; out += src.slice(i, end); i = end; continue; }
    const prev = i > 0 ? src[i - 1] : '';
    if (!/[\w.$]/.test(prev)) {
      const m = REF_RE.exec(src.slice(i));
      if (m && (ch === "'" || /[A-Za-z$]/.test(ch))) {
        const refm = /^(\$?)([A-Za-z]{1,3})(\$?)(\d{1,6})$/.exec(m[2])!;
        let sheet = m[1]; if (sheet?.startsWith("'")) sheet = sheet.slice(1, -1).replace(/''/g, "'");
        const r = Number(refm[4]) - 1, c = colIndex(refm[2]);
        const res = fn({ sheet: sheet || undefined, r, c, absR: refm[3] === '$', absC: refm[1] === '$' });
        const prefix = m[1] ? `${m[1]}!` : '';
        out += res == null ? `${prefix}#REF!` : prefix + res;
        i += m[0].length; continue;
      }
    }
    out += ch; i++;
  }
  return out;
}
const fmtRef = (r: number, c: number, absR: boolean, absC: boolean) => `${absC ? '$' : ''}${colName(c)}${absR ? '$' : ''}${r + 1}`;

/** Shift refs pointing at `tab` after inserting (delta>0) or deleting
 *  (delta<0) rows/cols at index `at`. `formulaTab` is where the formula lives. */
export function shiftFormula(f: string, formulaTab: string, tab: string, axis: 'row' | 'col', at: number, delta: number): string {
  return rewriteRefs(f, (ref) => {
    const target = (ref.sheet ?? formulaTab).toLowerCase();
    if (target !== tab.toLowerCase()) return fmtRef(ref.r, ref.c, ref.absR, ref.absC);
    let { r, c } = ref;
    const v = axis === 'row' ? r : c;
    if (delta < 0 && v >= at && v < at - delta) return null;
    if (v >= at) { if (axis === 'row') r += delta; else c += delta; }
    return fmtRef(r, c, ref.absR, ref.absC);
  });
}
/** Copy/paste and fill: relative refs move with the cell, $-anchored don't. */
export function offsetFormula(f: string, dr: number, dc: number): string {
  return rewriteRefs(f, (ref) => {
    const r = ref.absR ? ref.r : ref.r + dr, c = ref.absC ? ref.c : ref.c + dc;
    if (r < 0 || c < 0) return null;
    return fmtRef(r, c, ref.absR, ref.absC);
  });
}
