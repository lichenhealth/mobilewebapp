// Shared ICS (RFC 5545) building — used by calendar-feed (the standing
// subscription feed) and send-calendar-invite (iTIP invitations). One copy so
// the two can never disagree about times or recurrence. The RRULE converter
// MIRRORS src/lib/recurrence.ts exactly — change the engine, change this.

export interface Rec {
  freq: 'daily' | 'weekly' | 'monthly' | 'yearly';
  interval?: number;
  byday?: number[];                 // 0=Mon … 6=Sun
  monthMode?: 'date' | 'weekday';
  end?: { type: 'never' } | { type: 'until'; date: string } | { type: 'count'; n: number };
}
export interface Ev {
  id: string; title: string | null; description: string | null; location: string | null;
  start_date: string; end_date: string | null; all_day: boolean;
  start_min: number | null; end_min: number | null; recurrence: Rec | null;
  _tentative?: boolean;
}


/** RFC 5545 text escaping. */
export const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** Fold lines at ~74 octets (spec says 75; continuation lines start with a space). */
export function fold(line: string): string {
  const out: string[] = [];
  let rest = line;
  while (rest.length > 74) { out.push(rest.slice(0, 74)); rest = ' ' + rest.slice(74); }
  out.push(rest);
  return out.join('\r\n');
}

export const DAYCODES = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
export const d8 = (iso: string) => iso.replace(/-/g, '');
export const hm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}${String(min % 60).padStart(2, '0')}00`;
export function plusDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
/** Mon=0 weekday of a yyyy-mm-dd. */
export const wd = (iso: string) => (new Date(`${iso}T12:00:00Z`).getUTCDay() + 6) % 7;
export const nthOfMonth = (iso: string) => Math.floor((Number(iso.slice(8, 10)) - 1) / 7) + 1;
export function isLastOfMonth(iso: string): boolean {
  const d = new Date(`${iso}T12:00:00Z`);
  const dim = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  return d.getUTCDate() + 7 > dim;
}

/** The RRULE-lite spec → an RFC 5545 RRULE, mirroring recurrence.ts exactly. */
export function rrule(rec: Rec, anchor: string): string {
  const parts = [`FREQ=${rec.freq.toUpperCase()}`];
  const interval = Math.max(1, rec.interval || 1);
  if (interval > 1) parts.push(`INTERVAL=${interval}`);
  if (rec.freq === 'weekly') {
    const byday = rec.byday?.length ? rec.byday : [wd(anchor)];
    parts.push(`BYDAY=${byday.map((d) => DAYCODES[d]).join(',')}`);
  }
  if (rec.freq === 'monthly' && rec.monthMode === 'weekday') {
    // recurrence.ts: a last-of-month anchor means "the LAST <weekday>".
    const n = isLastOfMonth(anchor) ? -1 : nthOfMonth(anchor);
    parts.push(`BYDAY=${n}${DAYCODES[wd(anchor)]}`);
  }
  const end = rec.end ?? { type: 'never' };
  if (end.type === 'until') parts.push(`UNTIL=${d8(end.date)}T235959Z`);
  if (end.type === 'count') parts.push(`COUNT=${Math.max(1, end.n)}`);
  return parts.join(';');
}

/** Wall-clock (date + minutes) in an IANA zone → a UTC stamp yyyymmddThhmmssZ.
 *  Two-pass Intl offset correction, no tz library (bookingApi's method). */
export function zonedUtc(iso: string, min: number, tz: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d, Math.floor(min / 60), min % 60);
  const offset = (t: number) => {
    const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
      .formatToParts(new Date(t)).reduce((a, x) => (a[x.type] = x.value, a), {} as Record<string, string>);
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute) - t;
  };
  let t = guess - offset(guess);
  t = guess - offset(t);
  return new Date(t).toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
}

export function vevent(e: Ev, tz: string, now: string, extra: string[] = [], opts: { utc?: boolean } = {}): string {
  const lines = ['BEGIN:VEVENT', `UID:${e.id}@lichen.health`, `DTSTAMP:${now}`];
  if (e.all_day || e.start_min == null) {
    lines.push(`DTSTART;VALUE=DATE:${d8(e.start_date)}`);
    // DTEND on all-day events is EXCLUSIVE — the day after the last day.
    lines.push(`DTEND;VALUE=DATE:${d8(plusDays(e.end_date ?? e.start_date, 1))}`);
  } else {
    const endMin = e.end_min != null && e.end_min > e.start_min ? e.end_min : e.start_min + 60;
    const endDate = (e.end_date && e.end_date > e.start_date) ? e.end_date : e.start_date;
    if (opts.utc && !e.recurrence) {
      // Invitations: an exact instant every calendar converts on its own.
      lines.push(`DTSTART:${zonedUtc(e.start_date, e.start_min, tz)}`);
      lines.push(`DTEND:${zonedUtc(endDate, endMin, tz)}`);
    } else {
      lines.push(`DTSTART;TZID=${tz}:${d8(e.start_date)}T${hm(e.start_min)}`);
      lines.push(`DTEND;TZID=${tz}:${d8(endDate)}T${hm(endMin)}`);
    }
  }
  if (e.recurrence) lines.push(`RRULE:${rrule(e.recurrence, e.start_date)}`);
  lines.push(`SUMMARY:${esc(e.title || 'Lichen event')}`);
  if (e.description) lines.push(`DESCRIPTION:${esc(e.description)}`);
  if (e.location) lines.push(`LOCATION:${esc(e.location)}`);
  if (e._tentative) lines.push('STATUS:TENTATIVE');
  lines.push(...extra);
  lines.push('END:VEVENT');
  return lines.map(fold).join('\r\n');
}

