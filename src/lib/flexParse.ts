import { todayISO, addDays } from './conciergeApi';

// ─── Flexible-dates sentence parser (founder ask, 2026-07-18) ────────────────
// Same philosophy as smartSearch.ts: RULE-BASED and deterministic — no AI
// call, phrases either parse or they don't. Understands things like:
//   "a 3 day retreat between July 1 and August 31 with Gabe and the WAG group"
// → length, search window, and names matched against real members/spaces.

export interface NamedThing { id: string; name: string }
export interface FlexParsed {
  days: number | null;
  from: string | null;          // ISO search-window bounds
  to: string | null;
  memberIds: string[];
  spaceIds: string[];
  chips: string[];              // human-readable "understood" tokens
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DATE_TOK = String.raw`(?:(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})|(\d{1,2})[/](\d{1,2}))`;

/** "july 1" / "7/1" → ISO in the current year, bumped forward if already past. */
function resolveTok(m: string | undefined, d1: string | undefined, mm: string | undefined, dd: string | undefined): string | null {
  const year = new Date().getFullYear();
  let month: number; let day: number;
  if (m && d1) { month = MONTHS.indexOf(m); day = Number(d1); }
  else if (mm && dd) { month = Number(mm) - 1; day = Number(dd); }
  else return null;
  if (month < 0 || month > 11 || day < 1 || day > 31) return null;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${year}-${pad(month + 1)}-${pad(day)}`;
}

const bump = (iso: string) => `${Number(iso.slice(0, 4)) + 1}${iso.slice(4)}`;

export function parseFlex(q: string, members: NamedThing[], spaces: NamedThing[]): FlexParsed {
  const lo = q.toLowerCase();
  const out: FlexParsed = { days: null, from: null, to: null, memberIds: [], spaceIds: [], chips: [] };
  const today = todayISO();

  const dayM = lo.match(/(\d{1,2})\s*-?\s*day/);
  if (dayM) {
    out.days = Math.min(14, Math.max(1, Number(dayM[1])));
    out.chips.push(out.days === 1 ? '1 day' : `${out.days} days`);
  }

  // "between july 1 and august 31" · "from 7/1 to 8/31" · "july 1 - august 31"
  const rangeRe = new RegExp(DATE_TOK + String.raw`\s*(?:and|to|until|through|thru|[-–])\s*` + DATE_TOK);
  const r = lo.match(rangeRe);
  if (r) {
    let from = resolveTok(r[1], r[2], r[3], r[4]);
    let to = resolveTok(r[5], r[6], r[7], r[8]);
    if (from && to) {
      if (to < from) to = bump(to);
      if (to < today) { from = bump(from); to = bump(to); }
      out.from = from; out.to = to;
    }
  } else {
    // "in august" → that whole month (next year's if it already passed)
    const im = lo.match(/\bin\s+(january|february|march|april|may|june|july|august|september|october|november|december)/);
    if (im) {
      const month = MONTHS.indexOf(im[1].slice(0, 3));
      const year = new Date().getFullYear();
      const pad = (n: number) => String(n).padStart(2, '0');
      let from = `${year}-${pad(month + 1)}-01`;
      let to = `${year}-${pad(month + 1)}-${pad(new Date(year, month + 1, 0).getDate())}`;
      if (to < today) { from = bump(from); to = bump(to); }
      out.from = from; out.to = to;
    }
  }
  if (out.from && out.to) out.chips.push(`${out.from.slice(5).replace('-', '/')} – ${out.to.slice(5).replace('-', '/')}`);

  // Names: match a member's full name, or their first name as a whole word.
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const m of members) {
    const full = (m.name ?? '').trim().toLowerCase();
    if (full.length < 3) continue;
    const first = full.split(/\s+/)[0];
    const hit = lo.includes(full)
      || (first.length >= 3 && new RegExp(`\\b${escape(first)}\\b`).test(lo));
    if (hit) { out.memberIds.push(m.id); out.chips.push(m.name); }
  }
  for (const s of spaces) {
    const n = (s.name ?? '').trim().toLowerCase();
    if (n.length < 3) continue;
    const firstWord = n.split(/[\s:–—-]+/)[0];
    const hit = lo.includes(n)
      || (firstWord.length >= 3 && new RegExp(`\\b${escape(firstWord)}\\b`).test(lo));
    if (hit) { out.spaceIds.push(s.id); out.chips.push(s.name); }
  }
  return out;
}

/** Default search window when the sentence doesn't name one. */
export function defaultWindow(): { from: string; to: string } {
  return { from: addDays(todayISO(), 1), to: addDays(todayISO(), 56) };
}
