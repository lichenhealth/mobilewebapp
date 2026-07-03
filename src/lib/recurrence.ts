// Gmail-style recurrence for KOC care-plan posts. A post stores an anchor date
// (start_date) + an optional `recurrence` spec; the weekly view asks occursOn()
// whether the post lands on each visible day. All dates are yyyy-mm-dd strings
// in LOCAL time (via localDate/toISO), matching the rest of conciergeApi.
import { localDate, toISO } from './conciergeApi';

export type Freq = 'daily' | 'weekly' | 'monthly' | 'yearly';
export type RecEnd =
  | { type: 'never' }
  | { type: 'until'; date: string }
  | { type: 'count'; n: number };

export interface Recurrence {
  freq: Freq;
  interval: number;                 // ≥ 1 ("every N days/weeks/months/years")
  byday?: number[];                 // weekly: 0=Mon … 6=Sun (multiple = "Fri & Sat")
  monthMode?: 'date' | 'weekday';   // monthly: on the 12th | on the "2nd Tuesday"
  end: RecEnd;
}

/** Minimal shape occursOn needs — a CarePostRow satisfies it. */
export interface Schedulable {
  start_date: string | null;
  end_date: string | null;
  recurrence: Recurrence | null;
}

export const WEEKDAYS_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const WEEKDAYS_FULL = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth'];

// ── date helpers (Monday = 0) ────────────────────────────────────────────────
export function weekdayMon0(iso: string): number { return (localDate(iso).getDay() + 6) % 7; }
function daysBetween(a: string, b: string): number {
  return Math.round((localDate(b).getTime() - localDate(a).getTime()) / 86_400_000);
}
function monthsBetween(a: string, b: string): number {
  const da = localDate(a), db = localDate(b);
  return (db.getFullYear() - da.getFullYear()) * 12 + (db.getMonth() - da.getMonth());
}
function daysInMonth(y: number, m: number): number { return new Date(y, m + 1, 0).getDate(); }
/** Which occurrence of its weekday a date is within its month (1..5). */
function nthOfMonth(iso: string): number { return Math.floor((localDate(iso).getDate() - 1) / 7) + 1; }
/** Is this the LAST occurrence of its weekday in the month? */
function isLastOfMonth(iso: string): boolean {
  const d = localDate(iso);
  return d.getDate() + 7 > daysInMonth(d.getFullYear(), d.getMonth());
}

/** Does a recurrence (ignoring its end) produce `iso`, given the anchor? */
function matchesPattern(rec: Recurrence, anchor: string, iso: string): boolean {
  if (iso < anchor) return false;
  const interval = Math.max(1, rec.interval || 1);
  switch (rec.freq) {
    case 'daily':
      return daysBetween(anchor, iso) % interval === 0;
    case 'weekly': {
      const byday = rec.byday?.length ? rec.byday : [weekdayMon0(anchor)];
      if (!byday.includes(weekdayMon0(iso))) return false;
      // Align on the Monday of each date's week to count whole-week gaps.
      const wa = daysBetween(anchor, iso) - (weekdayMon0(iso) - weekdayMon0(anchor));
      return Math.round(wa / 7) % interval === 0;
    }
    case 'monthly': {
      if (monthsBetween(anchor, iso) % interval !== 0) return false;
      if (rec.monthMode === 'weekday') {
        if (weekdayMon0(iso) !== weekdayMon0(anchor)) return false;
        return isLastOfMonth(anchor) ? isLastOfMonth(iso) : nthOfMonth(iso) === nthOfMonth(anchor);
      }
      return localDate(iso).getDate() === localDate(anchor).getDate(); // 'date'
    }
    case 'yearly': {
      const da = localDate(anchor), di = localDate(iso);
      return (di.getFullYear() - da.getFullYear()) % interval === 0
        && di.getMonth() === da.getMonth() && di.getDate() === da.getDate();
    }
  }
}

/** 1-based index of `iso` among the occurrences (iso must already match). Walks
 *  from the anchor — bounded, and only used for count-limited recurrences. */
function occurrenceIndex(rec: Recurrence, anchor: string, iso: string): number {
  let count = 0;
  const d = localDate(anchor);
  const guard = Math.min(daysBetween(anchor, iso), 366 * 20); // hard cap
  for (let i = 0; i <= guard; i++) {
    const cur = toISO(d);
    if (matchesPattern(rec, anchor, cur)) count += 1;
    if (cur === iso) return count;
    d.setDate(d.getDate() + 1);
  }
  return count;
}

/** Does this post land on `iso`? Plain range when recurrence is null. */
export function occursOn(post: Schedulable, iso: string): boolean {
  const anchor = post.start_date;
  if (!anchor) return false;
  if (!post.recurrence) {
    return anchor <= iso && iso <= (post.end_date ?? anchor);
  }
  const rec = post.recurrence;
  if (!matchesPattern(rec, anchor, iso)) return false;
  if (rec.end.type === 'until') return iso <= rec.end.date;
  if (rec.end.type === 'count') return occurrenceIndex(rec, anchor, iso) <= Math.max(1, rec.end.n);
  return true; // never
}

// ── human labels ─────────────────────────────────────────────────────────────
function ordinal(iso: string): string {
  return isLastOfMonth(iso) ? 'last' : (ORDINALS[nthOfMonth(iso) - 1] ?? `${nthOfMonth(iso)}th`);
}
function monthDay(iso: string): string {
  return localDate(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
function endSuffix(end: RecEnd): string {
  if (end.type === 'until') return `, until ${monthDay(end.date)}`;
  if (end.type === 'count') return `, ${end.n} time${end.n === 1 ? '' : 's'}`;
  return '';
}

/** Human summary, e.g. "Every Fri & Sat, until Aug 30" / "Monthly on the first Thursday". */
export function recurrenceLabel(rec: Recurrence, anchor: string): string {
  const n = Math.max(1, rec.interval || 1);
  let base = '';
  if (rec.freq === 'daily') {
    base = n === 1 ? 'Daily' : `Every ${n} days`;
  } else if (rec.freq === 'weekly') {
    const byday = (rec.byday?.length ? rec.byday : [weekdayMon0(anchor)]).slice().sort((a, b) => a - b);
    if (n === 1 && byday.length === 5 && byday.every((d, i) => d === i)) {
      base = 'Every weekday';
    } else {
      const names = byday.map((d) => WEEKDAYS_SHORT[d]).join(' & ');
      base = n === 1 ? `Every ${names}` : `Every ${n} weeks on ${names}`;
    }
  } else if (rec.freq === 'monthly') {
    const each = n === 1 ? 'Monthly' : `Every ${n} months`;
    base = rec.monthMode === 'weekday'
      ? `${each} on the ${ordinal(anchor)} ${WEEKDAYS_FULL[weekdayMon0(anchor)]}`
      : `${each} on the ${localDate(anchor).getDate()}${nthSuffix(localDate(anchor).getDate())}`;
  } else {
    base = n === 1 ? `Annually on ${monthDay(anchor)}` : `Every ${n} years on ${monthDay(anchor)}`;
  }
  return base + endSuffix(rec.end);
}

function nthSuffix(d: number): string {
  if (d >= 11 && d <= 13) return 'th';
  return ['th', 'st', 'nd', 'rd'][d % 10] ?? 'th';
}

export interface Preset { label: string; recurrence: Recurrence | null; custom?: boolean }

/** Gmail-style dropdown options, smart-defaulted to the picked anchor day. */
export function presetsFor(anchor: string): Preset[] {
  const wd = weekdayMon0(anchor);
  const never: RecEnd = { type: 'never' };
  return [
    { label: 'Does not repeat', recurrence: null },
    { label: 'Daily', recurrence: { freq: 'daily', interval: 1, end: never } },
    { label: `Weekly on ${WEEKDAYS_FULL[wd]}`, recurrence: { freq: 'weekly', interval: 1, byday: [wd], end: never } },
    {
      label: `Monthly on the ${ordinal(anchor)} ${WEEKDAYS_FULL[wd]}`,
      recurrence: { freq: 'monthly', interval: 1, monthMode: 'weekday', end: never },
    },
    { label: `Annually on ${monthDay(anchor)}`, recurrence: { freq: 'yearly', interval: 1, end: never } },
    { label: 'Every weekday (Mon–Fri)', recurrence: { freq: 'weekly', interval: 1, byday: [0, 1, 2, 3, 4], end: never } },
    { label: 'Custom…', recurrence: null, custom: true },
  ];
}

/** Which preset (by label) matches a recurrence for the current anchor, else "Custom…". */
export function matchPresetLabel(rec: Recurrence | null, anchor: string): string {
  const presets = presetsFor(anchor);
  if (!rec) return 'Does not repeat';
  for (const p of presets) {
    if (!p.recurrence) continue;
    if (JSON.stringify(p.recurrence) === JSON.stringify(rec)) return p.label;
  }
  return 'Custom…';
}
