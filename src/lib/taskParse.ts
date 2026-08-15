import { supabase } from './supabase';
import { localDate, toISO, todayISO } from './conciergeApi';
import type { Recurrence } from './recurrence';
import type { Recipient } from './remindersApi';

// ─── The smart task composer (founder 2026-08-14) ────────────────────────────
// "return amazon package to staples in Conifer and add Gabe Miltner to the
// task" — one sentence becomes a task with a time and a person on it.
//
// DETERMINISTIC, like smartSearch.ts: no AI call, no cost, no latency, and
// nothing leaves the device to parse it. Same scan/claim/consumed idiom —
// recognized phrases are consumed, and WHAT'S LEFT IS THE TITLE, so the
// member's own words survive intact ("Return amazon package to staples in
// Conifer"). The reading is always shown before anything is created; a name
// only becomes an assignee if it resolves to a real member.

export interface ParsedTask {
  title: string;
  date: string | null;        // ISO — null = no day named
  atMin: number | null;       // exact time; null with a date = finish-by
  recurrence: Recurrence | null;
  /** Raw name text found after an assignment phrase, to resolve. */
  assigneeNames: string[];
}

const WEEK = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july',
  'august', 'september', 'october', 'november', 'december'];

const addDays = (iso: string, n: number): string => {
  const d = localDate(iso); d.setDate(d.getDate() + n); return toISO(d);
};

/** Next occurrence of a weekday (0=Sun…6=Sat); today counts only if `next`
 *  wasn't said and it's still today. */
function nextWeekday(target: number, next: boolean, from = todayISO()): string {
  const cur = localDate(from).getDay();
  let delta = (target - cur + 7) % 7;
  if (delta === 0 && next) delta = 7;
  if (next && delta < 7 && delta !== 0) delta += 0;   // "next friday" this week reads as this friday
  return addDays(from, delta);
}

function hhmm(h: number, m: number, ap?: string): number {
  let hour = h % 24;
  if (ap === 'pm' && hour < 12) hour += 12;
  if (ap === 'am' && hour === 12) hour = 0;
  // A bare "at 3" on a task means the afternoon far more often than 3am.
  if (!ap && hour >= 1 && hour <= 7) hour += 12;
  return hour * 60 + m;
}

export function parseTask(raw: string, today = todayISO()): ParsedTask {
  const consumed = new Array<boolean>(raw.length).fill(false);
  const claim = (start: number, end: number) => {
    for (let i = start; i < end; i++) consumed[i] = true;
  };
  const scan = (re: RegExp, onHit: (m: RegExpExecArray) => void) => {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(raw)) !== null) {
      if (consumed[m.index]) continue;
      onHit(m);
      claim(m.index, m.index + m[0].length);
    }
  };

  let date: string | null = null;
  let atMin: number | null = null;
  let recurrence: Recurrence | null = null;
  const assigneeNames: string[] = [];

  // ── Assignment, first: its name phrase must not be eaten by anything else.
  scan(/\badd\s+(.+?)\s+to\s+(?:the\s+|this\s+|my\s+)?(?:task|list|reminder|it)\b/gi,
    (m) => assigneeNames.push(m[1]));
  scan(/\b(?:assign(?:ed)?\s+(?:it\s+)?to|share\s+(?:it\s+)?with|nudge|remind)\s+(.+?)(?=\s+(?:on|at|by|every|tomorrow|today|next)\b|[,.]|$)/gi,
    (m) => assigneeNames.push(m[1]));
  scan(/\bwith\s+([A-Z][\w'’.-]*(?:\s+[A-Z][\w'’.-]*)?)\b/g,
    (m) => assigneeNames.push(m[1]));

  // ── Recurrence before single dates ("every friday" isn't "friday").
  scan(/\bevery\s+(day|week|month|year)\b|\b(daily|weekly|monthly|yearly)\b/gi, (m) => {
    const unit = (m[1] ?? m[2] ?? '').toLowerCase();
    const freq = unit.startsWith('day') || unit === 'daily' ? 'daily'
      : unit.startsWith('week') || unit === 'weekly' ? 'weekly'
      : unit.startsWith('month') || unit === 'monthly' ? 'monthly' : 'yearly';
    recurrence = { freq, interval: 1, end: { type: 'never' } };
  });
  scan(/\bevery\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)s?\b/gi, (m) => {
    const dow = WEEK.indexOf(m[1].toLowerCase());
    // recurrence.byday is Mon=0 … Sun=6; JS getDay is Sun=0.
    recurrence = { freq: 'weekly', interval: 1, byday: [(dow + 6) % 7], end: { type: 'never' } };
    date ??= nextWeekday(dow, false, today);
  });

  // ── Times.
  scan(/\b(?:at|@)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/gi, (m) => {
    atMin = hhmm(parseInt(m[1], 10), m[2] ? parseInt(m[2], 10) : 0, m[3]?.toLowerCase());
  });
  scan(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/gi, (m) => {
    atMin ??= hhmm(parseInt(m[1], 10), m[2] ? parseInt(m[2], 10) : 0, m[3].toLowerCase());
  });
  scan(/\bnoon\b/gi, () => { atMin ??= 12 * 60; });
  scan(/\bmidnight\b/gi, () => { atMin ??= 0; });

  // ── Days. "by <day>" reads as a finish-by (a day, no clock time).
  scan(/\b(?:by\s+|on\s+)?tomorrow\b/gi, () => { date ??= addDays(today, 1); });
  scan(/\b(?:by\s+|on\s+)?today\b|\btonight\b/gi, () => { date ??= today; });
  scan(/\bin\s+(\d{1,2})\s+(day|week)s?\b/gi, (m) => {
    date ??= addDays(today, parseInt(m[1], 10) * (m[2].toLowerCase().startsWith('week') ? 7 : 1));
  });
  scan(/\b(?:by\s+|on\s+|next\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/gi, (m) => {
    date ??= nextWeekday(WEEK.indexOf(m[1].toLowerCase()), /next/i.test(m[0]), today);
  });
  scan(/\b(?:by\s+|on\s+)?(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})\b/gi, (m) => {
    const y = localDate(today).getFullYear();
    const cand = toISO(new Date(y, MONTHS.indexOf(m[1].toLowerCase()), parseInt(m[2], 10)));
    date ??= cand < today ? toISO(new Date(y + 1, MONTHS.indexOf(m[1].toLowerCase()), parseInt(m[2], 10))) : cand;
  });
  scan(/\b(?:by\s+|on\s+)?(\d{1,2})\/(\d{1,2})\b/g, (m) => {
    const y = localDate(today).getFullYear();
    const cand = toISO(new Date(y, parseInt(m[1], 10) - 1, parseInt(m[2], 10)));
    date ??= cand < today ? toISO(new Date(y + 1, parseInt(m[1], 10) - 1, parseInt(m[2], 10))) : cand;
  });

  // ── What's left is the member's own sentence.
  let title = raw.split('').map((ch, i) => (consumed[i] ? ' ' : ch)).join('');
  title = title
    .replace(/\s+/g, ' ')
    .replace(/\s*,\s*/g, ', ')
    .replace(/^[\s,.;:-]+|[\s,.;:-]+$/g, '')
    .replace(/\band\s*$/i, '')
    .replace(/^\s*and\b/i, '')
    .trim();
  if (title) title = title[0].toUpperCase() + title.slice(1);

  return { title, date, atMin, recurrence, assigneeNames };
}

/** A name only becomes an assignee if it's a REAL member (or space) — an
 *  unmatched name simply stays part of the title, never a silent drop. */
export async function resolveAssignees(names: string[], me: string): Promise<Recipient[]> {
  const out: Recipient[] = [];
  for (const raw of names) {
    const n = raw.trim().replace(/[.,;]+$/, '');
    if (n.length < 2) continue;
    const [mem, sp] = await Promise.all([
      supabase.from('profiles').select('id, full_name').ilike('full_name', `%${n}%`).neq('id', me).limit(2),
      supabase.from('spaces').select('id, name').ilike('name', `%${n}%`).limit(2),
    ]);
    const people = (mem.data as { id: string; full_name: string | null }[] | null) ?? [];
    const spaces = (sp.data as { id: string; name: string }[] | null) ?? [];
    // Exactly one match is a confident read; two names matching equally well
    // is ambiguous, so leave it for the member to pick in the composer.
    if (people.length === 1 && spaces.length === 0) {
      out.push({ type: 'profile', id: people[0].id, name: people[0].full_name ?? 'Member' });
    } else if (spaces.length === 1 && people.length === 0) {
      out.push({ type: 'space', id: spaces[0].id, name: spaces[0].name });
    }
  }
  return out;
}
