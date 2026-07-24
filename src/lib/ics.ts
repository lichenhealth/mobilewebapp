// Build a downloadable .ics and a Google Calendar link from an event summary, so
// an outside guest can drop it into Apple/Google/Outlook. Times are "floating"
// local (no timezone) — they land at the same wall-clock in the guest's own
// calendar, which is what you want for a community event ("7pm" is 7pm).

export interface EventForCal {
  title: string;
  description?: string;
  location?: string;
  start_date: string;
  end_date: string;
  all_day: boolean;
  start_min: number | null;
  end_min: number | null;
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
  const start = stamp(e.start_date, e.start_min, e.all_day);
  const end = e.all_day
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
    'END:VEVENT', 'END:VCALENDAR',
  ].filter(Boolean).join('\r\n');
}

export function icsDataUri(e: EventForCal): string {
  return 'data:text/calendar;charset=utf-8,' + encodeURIComponent(icsFor(e));
}

export function googleCalUrl(e: EventForCal): string {
  const start = stamp(e.start_date, e.start_min, e.all_day);
  const end = e.all_day ? nextDay(e.end_date) : stamp(e.end_date, e.end_min ?? e.start_min, false);
  const p = new URLSearchParams({
    action: 'TEMPLATE',
    text: e.title,
    dates: `${start}/${end}`,
    details: e.description ?? '',
    location: e.location ?? '',
  });
  return `https://calendar.google.com/calendar/render?${p.toString()}`;
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}
