// Build a downloadable .ics and a Google Calendar link from an event summary, so
// an outside guest can drop it into Apple/Google/Outlook. With `tz` known the
// times leave as real UTC instants (each calendar converts to its own zone);
// without it they stay floating local.

export interface EventForCal {
  title: string;
  description?: string;
  location?: string;
  /** A join link for the session — rides the ICS URL property so calendar
   *  apps keep a real door even when `location` is the pretty service name
   *  ("Zoom") rather than the raw address (founder 2026-10-07: "zoom be
   *  what is shown in the invite as the link… instead of a long, ugly URL"). */
  url?: string;
  start_date: string;
  end_date: string;
  all_day: boolean;
  start_min: number | null;
  end_min: number | null;
  /** WHOSE clock the minutes are on (IANA). Given it, timed events leave as
   *  real UTC instants and every calendar shows them in its OWN zone
   *  (founder 2026-11-09: a PST client's calendar filed an 11am MST session
   *  at 11am PT — floating times land at the same wall-clock everywhere).
   *  Omit only for genuinely floating times. */
  tz?: string | null;
}

/** Wall-clock minutes in `tz` on `date` → the real instant. */
function instant(date: string, min: number, tz: string): Date | null {
  try {
    const target = Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10), Math.floor(min / 60), min % 60);
    let guess = target;
    for (let i = 0; i < 2; i++) {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
      }).formatToParts(new Date(guess));
      const get = (t: string) => +(parts.find((x) => x.type === t)?.value ?? '0');
      guess += target - Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'));
    }
    return new Date(guess);
  } catch { return null; }
}
const utcStamp = (d: Date) =>
  `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`;
/** A timed event's start/end as UTC stamps, when its zone is known. */
function utcPair(e: EventForCal): [Date, Date] | null {
  if (e.all_day || e.start_min == null || !e.tz) return null;
  const a = instant(e.start_date, e.start_min, e.tz);
  const b = instant(e.end_date, e.end_min ?? e.start_min, e.tz);
  return a && b ? [a, b] : null;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** yyyymmdd or yyyymmddThhmmss (floating local). */
function stamp(date: string, min: number | null, allDay: boolean): string {
  const [y, m, d] = date.split('-').map(Number);
  const day = `${y}${pad(m)}${pad(d)}`;
  if (allDay || min == null) return day;
  return `${day}T${pad(Math.floor(min / 60))}${pad(min % 60)}00`;
}

/** For an all-day event, DTEND is exclusive → next day. */
function nextDay(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + 1));
  return `${dt.getUTCFullYear()}${pad(dt.getUTCMonth() + 1)}${pad(dt.getUTCDate())}`;
}

export function icsFor(e: EventForCal): string {
  const u = utcPair(e);
  const start = u ? utcStamp(u[0]) : stamp(e.start_date, e.start_min, e.all_day);
  const end = u ? utcStamp(u[1]) : e.all_day
    ? nextDay(e.end_date)
    : stamp(e.end_date, e.end_min ?? e.start_min, false);
  const dt = e.all_day ? { s: `DTSTART;VALUE=DATE:${start}`, e: `DTEND;VALUE=DATE:${end}` }
    : { s: `DTSTART:${start}`, e: `DTEND:${end}` };
  const esc = (s: string) => (s || '').replace(/\\/g, '\\\\').replace(/,/g, '\\,').replace(/;/g, '\\;').replace(/\n/g, '\\n');
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Lichen//EN', 'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${start}-${Math.abs(hash(e.title))}@lichen.healthcare`,
    dt.s, dt.e,
    `SUMMARY:${esc(e.title)}`,
    e.description ? `DESCRIPTION:${esc(e.description)}` : '',
    e.location ? `LOCATION:${esc(e.location)}` : '',
    e.url ? `URL:${e.url}` : '',
    'END:VEVENT', 'END:VCALENDAR',
  ].filter(Boolean).join('\r\n');
}

export function icsDataUri(e: EventForCal): string {
  return 'data:text/calendar;charset=utf-8,' + encodeURIComponent(icsFor(e));
}

export function googleCalUrl(e: EventForCal): string {
  const u = utcPair(e);
  const start = u ? utcStamp(u[0]) : stamp(e.start_date, e.start_min, e.all_day);
  const end = u ? utcStamp(u[1]) : e.all_day ? nextDay(e.end_date) : stamp(e.end_date, e.end_min ?? e.start_min, false);
  const p = new URLSearchParams({
    action: 'TEMPLATE',
    text: e.title,
    dates: `${start}/${end}`,
    details: e.description ?? '',
    location: e.location ?? '',
  });
  return `https://calendar.google.com/calendar/render?${p.toString()}`;
}

/** Next day with dashes — Outlook's all-day enddt wants ISO dates. */
function nextDayDash(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + 1));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

/** Outlook-family deeplinks (founder 2026-11-02: "links to the major
 *  calendars out there") — the same floating-local times as the ICS. */
function outlookParams(e: EventForCal): string {
  const iso = (date: string, min: number) =>
    `${date}T${pad(Math.floor(min / 60))}:${pad(min % 60)}:00`;
  const p = new URLSearchParams({ path: '/calendar/action/compose', rru: 'addevent', subject: e.title });
  if (e.all_day || e.start_min == null) {
    p.set('startdt', e.start_date);
    p.set('enddt', nextDayDash(e.end_date));
    p.set('allday', 'true');
  } else {
    const u = utcPair(e);
    // Outlook reads an ISO instant with Z as UTC and shows it in the viewer's zone.
    p.set('startdt', u ? u[0].toISOString().replace(/\.\d{3}Z$/, 'Z') : iso(e.start_date, e.start_min));
    p.set('enddt', u ? u[1].toISOString().replace(/\.\d{3}Z$/, 'Z') : iso(e.end_date, e.end_min ?? e.start_min));
  }
  const body = [e.description, e.url].filter(Boolean).join('\n');
  if (body) p.set('body', body);
  if (e.location) p.set('location', e.location);
  return p.toString();
}

export function outlookCalUrl(e: EventForCal): string {
  return `https://outlook.live.com/calendar/0/deeplink/compose?${outlookParams(e)}`;
}

export function office365CalUrl(e: EventForCal): string {
  return `https://outlook.office.com/calendar/0/deeplink/compose?${outlookParams(e)}`;
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}
